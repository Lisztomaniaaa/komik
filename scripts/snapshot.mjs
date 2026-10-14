// Snapshot generator for KomikVibe's discovery data.
//
// Run by .github/workflows/snapshot.yml every ~30 minutes (and manually
// via workflow_dispatch). It fetches the comic catalogs from the Sanka
// provider instances ONCE, server-side, normalizes everything into the
// app's own Comic shape, rewrites cover URLs through the wsrv.nl image
// pipeline, and writes plain JSON files that the workflow force-pushes
// to the `snapshot` branch as a single orphan commit:
//
//   data/home.json         trending + latest rail + genre list (home screen)
//   data/genre-<slug>.json first pages of one genre (genre browsing)
//   data/type-<type>.json  first pages of one type (Manga/Manhwa/Manhua)
//
// The app reads these from raw.githubusercontent.com (which serves any
// branch with `Access-Control-Allow-Origin: *` and a 300s cache) and
// only falls back to live provider calls for what the snapshot does not
// cover (deeper pagination, combined filters, search, detail, chapters). If a run cannot
// produce a sane snapshot it exits non-zero and the workflow publishes
// NOTHING — the previous snapshot keeps serving. An upstream outage
// therefore degrades the app to slightly stale data instead of errors,
// and the upstream instances see ~100 requests per run regardless of
// how much user traffic the app gets.
//
// Usage: node scripts/snapshot.mjs [--out DIR]   (default: ./out)

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCES = [
  { name: "sanka-komikindo", base: "https://www.sankavollerei.web.id/comic/komikindo" },
  { name: "sanka-komikcast", base: "https://komikcast.aoxi.my.id/comic/komikcast" },
];

const args = process.argv.slice(2);
const outDir = path.resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : "out");
const dataDir = path.join(outDir, "data");

// ---------------------------------------------------------------------------
// Mapping helpers — mirrors of the client-side ones in src/comicApi.ts
// (kept in sync by hand; the shapes they consume were verified live).
// ---------------------------------------------------------------------------

function cleanTitle(raw) {
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").trim().replace(/^Komik\s+/i, "");
}
function mapType(raw) {
  const t = (raw || "").toLowerCase();
  if (t.includes("manhwa") || t.includes("webtoon")) return "Manhwa";
  if (t.includes("manhua")) return "Manhua";
  return "Manga";
}
function parseRating(raw) {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 10) / 10;
}
const RELATIVE_UNIT_MS = {
  detik: 1_000, menit: 60_000, jam: 3_600_000, hari: 86_400_000,
  minggu: 604_800_000, bulan: 2_592_000_000, tahun: 31_536_000_000,
};
function relativeIdToIso(raw) {
  const now = Date.now();
  if (!raw) return new Date(now).toISOString();
  const t = raw.toLowerCase();
  if (t.includes("kemarin")) return new Date(now - 86_400_000).toISOString();
  const m = /(\d+)\s*(detik|menit|jam|hari|minggu|bulan|tahun)/.exec(t);
  if (m) return new Date(now - parseInt(m[1], 10) * RELATIVE_UNIT_MS[m[2]]).toISOString();
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return new Date(now).toISOString();
}
const HIATUS_AFTER_MS = 1000 * 60 * 60 * 24 * 180;
function deriveStatus(latestChapterDate) {
  if (!latestChapterDate) return "Ongoing";
  const t = Date.parse(relativeIdToIso(latestChapterDate));
  return Date.now() - t > HIATUS_AFTER_MS ? "Hiatus" : "Ongoing";
}

// Covers are the slowest, heaviest part of the app (origin CDNs answer
// in ~0.6–1.4s and ship small-but-heavy thumbnails). Route them through
// wsrv.nl: resized to a card-appropriate width and re-encoded to WebP,
// served from a real CDN. The untouched origin URL rides along as
// `coverFallback` so the client can swap back if wsrv ever fails.
function coverUrls(origin) {
  if (!origin || !/^https?:\/\//.test(origin)) return { cover: origin || null, coverFallback: null };
  const stripped = origin.replace(/^https:\/\//, "ssl:").replace(/^http:\/\//, "");
  return {
    cover: `https://images.weserv.nl/?url=${encodeURIComponent(stripped)}&w=472&output=webp`,
    coverFallback: origin,
  };
}

function mapListItem(sourceName, raw) {
  const { cover, coverFallback } = coverUrls(raw.image);
  return {
    id: `${sourceName}:${raw.slug}`,
    title: cleanTitle(raw.title),
    type: mapType(raw.type),
    genres: [],
    status: deriveStatus(raw.chapters?.[0]?.date),
    rating: parseRating(raw.rating),
    chapters: 0,
    readers: "-",
    desc: "",
    cover,
    ...(coverFallback ? { coverFallback } : {}),
  };
}

// ---------------------------------------------------------------------------
// Fetching with a small concurrency pool — a run should be quick, but
// these are community instances; 4 in flight is plenty and polite.
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "KomikVibe snapshot generator" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const json = await res.json();
  if (json && json.success === false) throw new Error(`success=false: ${url}`);
  return json;
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// One full snapshot attempt against one source. Throws on anything that
// would make the snapshot not worth publishing.
// ---------------------------------------------------------------------------

const LATEST_TARGET = 80;
const GENRE_PAGES = 2;
const TYPE_PAGES = 2;
const MAX_GENRES = 40;
const TYPES = ["Manga", "Manhwa", "Manhua"];

async function buildFrom(source) {
  const get = (p) => fetchJson(`${source.base}${p}`);
  const generatedAt = new Date().toISOString();
  const meta = { generatedAt, source: source.name };

  // Home bundle: one latest response carries both rails (komikList for
  // Latest, komikPopuler for Trending).
  const latestPages = [];
  let page = 1;
  let collected = 0;
  while (collected < LATEST_TARGET) {
    const res = await get(`/latest/${page}`);
    const items = res.komikList || [];
    if (items.length === 0) break;
    latestPages.push(res);
    collected += items.length;
    if (!res.pagination?.hasNextPage) break;
    page += 1;
  }
  const trending = (latestPages[0]?.komikPopuler || []).map((raw) => mapListItem(source.name, raw));
  const latest = latestPages.flatMap((res) => (res.komikList || []).map((raw) => mapListItem(source.name, raw)));

  const genresRes = await get("/genres");
  const genres = (genresRes.genres || [])
    .map((g) => ({ title: g.name, slug: g.value }))
    .filter((g) => g.slug !== "adult" && g.slug !== "mature")
    .sort((a, b) => a.title.localeCompare(b.title));

  // Per-genre and per-type first pages. A failing individual file is
  // skipped (the client falls back to live for it) rather than failing
  // the whole run — only the home/explore core is load-bearing.
  const files = new Map();
  const genreSlugs = genres.slice(0, MAX_GENRES).map((g) => g.slug);
  await pool(genreSlugs, 4, async (slug) => {
    try {
      const pages = await pool(
        Array.from({ length: GENRE_PAGES }, (_, i) => i + 1),
        2,
        (p) => get(`/library?genre=${encodeURIComponent(slug)}&page=${p}`),
      );
      const items = pages.flatMap((res) => (res?.komikList || []).map((raw) => mapListItem(source.name, raw)));
      if (items.length > 0) files.set(`genre-${slug}.json`, { ...meta, genre: slug, items });
    } catch {
      /* live fallback covers this genre */
    }
  });
  await pool(TYPES, 3, async (type) => {
    try {
      const pages = await pool(
        Array.from({ length: TYPE_PAGES }, (_, i) => i + 1),
        2,
        (p) => get(`/library?type=${encodeURIComponent(type)}&page=${p}`),
      );
      const items = pages.flatMap((res) => (res?.komikList || []).map((raw) => mapListItem(source.name, raw)));
      if (items.length > 0) files.set(`type-${type.toLowerCase()}.json`, { ...meta, type, items });
    } catch {
      /* live fallback covers this type */
    }
  });

  // Sanity gates: publishing a worse-than-useless snapshot is worse
  // than publishing none (the client prefers the snapshot when it
  // exists), so a thin result fails the run and the old snapshot stays.
  if (trending.length < 5) throw new Error(`trending too thin (${trending.length})`);
  if (latest.length < 20) throw new Error(`latest too thin (${latest.length})`);
  if (genres.length < 10) throw new Error(`genres too thin (${genres.length})`);

  files.set("home.json", { ...meta, trending, latest, genres });
  return files;
}

// ---------------------------------------------------------------------------

async function main() {
  let lastError = null;
  for (const source of SOURCES) {
    try {
      console.log(`Building snapshot from ${source.name} ...`);
      const files = await buildFrom(source);
      await mkdir(dataDir, { recursive: true });
      for (const [name, data] of files) {
        await writeFile(path.join(dataDir, name), JSON.stringify(data));
      }
      await writeFile(
        path.join(outDir, "README.md"),
        "# snapshot branch\n\nGenerated comic-catalog snapshots for KomikVibe. Written by " +
          "`scripts/snapshot.mjs` via the `snapshot` GitHub Actions workflow — do not edit by hand. " +
          "The app reads `data/*.json` from this branch through raw.githubusercontent.com.\n",
      );
      const totalKb = [...files.values()].reduce((n, d) => n + JSON.stringify(d).length, 0) / 1024;
      console.log(`OK: ${files.size} files, ${totalKb.toFixed(0)} KB total, source=${source.name}`);
      return;
    } catch (err) {
      console.error(`Source ${source.name} failed: ${err.message}`);
      lastError = err;
    }
  }
  throw lastError || new Error("all sources failed");
}

main().catch((err) => {
  console.error(`Snapshot run FAILED (nothing published): ${err.message}`);
  process.exit(1);
});
