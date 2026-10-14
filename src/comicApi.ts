import type { ChapterEntry, Comic, ComicStatus, ComicType } from "./types";

// Multi-provider comic data layer — replaces the single-source Sansekai
// client this app used before (see the "Comic data source" section of
// README.md for the full history). Sansekai's data endpoints started
// answering 403 in October 2026, which killed the whole app because it
// had exactly one source and no fallback — the fourth source to die on
// this project (Komikcast scraper, a self-hosted Komiku fork, then
// Sansekai). The fix here is structural, not another provider swap:
//
//   1. "sanka-komikcast" — KomikCast catalog in the Sanka JSON format
//      (https://komikcast.aoxi.my.id/comic/komikcast)
//   2. "sanka-komikindo" — KomikIndo catalog, same Sanka format
//      (https://www.sankavollerei.web.id/comic/komikindo)
//   3. "mangadex" — the official MangaDex API (https://api.mangadex.org)
//
// The two Sanka instances speak an IDENTICAL response format, so a
// single client serves both and discovery calls (list / search /
// trending / latest / genres) fail over between providers in priority
// order: a provider that errors is marked down for a cooldown period
// and skipped, so one dead source degrades the app instead of killing
// it. Detail and chapter calls do NOT fail over across providers — a
// comic's content lives on the provider it was discovered on, which is
// why every Comic.id / ChapterEntry.id is namespaced by provider
// ("sanka-komikcast:<slug>", "mangadex:<uuid>") and routed back to its
// owner. (This also namespaces the Firestore keys that hang off comic
// ids — comments, ratings, view counts.) Unprefixed ids are legacy
// bookmarks from the Sansekai era; they are guessed as Sanka slugs.
//
// MangaDex is last on purpose: its API is the only one here that can
// never really die (official, free), but its Indonesian-translated
// catalog is much thinner than the Indo aggregator catalogs (verified
// 2026-10-14: 95,091 titles overall, only 6,972 with Indonesian
// chapters). It's the insurance layer, not the main catalog.

const SANKA_KOMIKCAST_BASE =
  (import.meta.env.VITE_SANKA_KOMIKCAST_BASE as string) || "https://komikcast.aoxi.my.id/comic/komikcast";
const SANKA_KOMIKINDO_BASE =
  (import.meta.env.VITE_SANKA_KOMIKINDO_BASE as string) || "https://www.sankavollerei.web.id/comic/komikindo";
const MANGADEX_BASE = (import.meta.env.VITE_MANGADEX_API_BASE as string) || "https://api.mangadex.org";

// ---------------------------------------------------------------------------
// Shared fetch + cache. Identical GETs are deduped and cached for the
// life of the page (same strategy as the old client — it kept Sansekai's
// 5-requests/minute tier survivable, and it still saves real traffic
// here even though the Sanka instances state no such limit). Failures
// are never cached, so a transient error can't poison a path forever.
// ---------------------------------------------------------------------------
const requestCache = new Map<string, Promise<unknown>>();
async function getJson<T>(url: string): Promise<T> {
  let pending = requestCache.get(url);
  if (!pending) {
    pending = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`);
      return res.json();
    });
    requestCache.set(url, pending);
    pending.catch(() => requestCache.delete(url));
  }
  return pending as Promise<T>;
}

// ---------------------------------------------------------------------------
// Shared mapping helpers
// ---------------------------------------------------------------------------

// Source titles arrive dirty: detail pages prefix them with
// "Komik\n              " and pad chapter titles with newlines/spaces.
function cleanTitle(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").trim().replace(/^Komik\s+/i, "");
}

function mapType(raw: string | undefined | null): ComicType {
  const t = (raw || "").toLowerCase();
  if (t.includes("manhwa") || t.includes("webtoon")) return "Manhwa";
  if (t.includes("manhua")) return "Manhua";
  return "Manga";
}

function parseRating(raw: string | number | undefined | null): number {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 10) / 10;
}

function formatCount(n: number | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n) || n <= 0) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

function parseChapterNumber(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = /chapter\s*([\d]+(?:\.\d+)?)/i.exec(text) || /-chapter-([\d]+(?:\.\d+)?)/i.exec(text);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

// The Sanka sources date chapters with Indonesian relative strings
// ("5 menit lalu", "16 jam yang lalu", "2 hari yang lalu"), but
// ChapterEntry.publishAt is rendered with `new Date(...)` in the UI, so
// the string is converted to an approximate absolute ISO timestamp.
// Precision doesn't matter at these scales — except that the hiatus
// heuristic below consumes the same value.
const RELATIVE_UNIT_MS: Record<string, number> = {
  detik: 1_000,
  menit: 60_000,
  jam: 3_600_000,
  hari: 86_400_000,
  minggu: 604_800_000,
  bulan: 2_592_000_000, // 30 days
  tahun: 31_536_000_000, // 365 days
};
function relativeIdToIso(raw: string | undefined | null): string {
  const now = Date.now();
  if (!raw) return new Date(now).toISOString();
  const t = raw.toLowerCase();
  if (t.includes("kemarin")) return new Date(now - 86_400_000).toISOString();
  const m = /(\d+)\s*(detik|menit|jam|hari|minggu|bulan|tahun)/.exec(t);
  if (m) return new Date(now - parseInt(m[1], 10) * RELATIVE_UNIT_MS[m[2]]).toISOString();
  // Some payloads carry a real date instead of a relative string.
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return new Date(now).toISOString();
}

// Same heuristic the Sansekai client used: a title whose latest chapter
// is older than 180 days reads as "Hiatus" (no source here exposes a
// trustworthy list-level status; detail pages do, see mapSankaStatus).
const HIATUS_AFTER_MS = 1000 * 60 * 60 * 24 * 180;
function deriveStatusFromIso(iso: string | undefined): ComicStatus {
  if (!iso) return "Ongoing";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Ongoing";
  return Date.now() - t > HIATUS_AFTER_MS ? "Hiatus" : "Ongoing";
}

// Detail pages carry a real status, in Indonesian ("Berjalan" = ongoing,
// "Tamat" = completed).
function mapSankaStatus(raw: string | undefined | null): ComicStatus {
  const t = (raw || "").toLowerCase();
  if (t.includes("tamat") || t.includes("completed") || t.includes("end")) return "Completed";
  if (t.includes("hiatus")) return "Hiatus";
  if (t.includes("batal") || t.includes("cancel")) return "Cancelled";
  return "Ongoing";
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Public query/genre shapes — deliberately identical to the old client's
// so app.ts only changes its import.
// ---------------------------------------------------------------------------
export interface ListQuery {
  offset: number;
  limit: number;
  sort: "latest" | "rating" | "az";
  type?: ComicType | "All";
  genre?: string | "All";
  status?: ComicStatus | "All";
  title?: string;
}

export interface Genre {
  title: string;
  slug: string;
}

interface Provider {
  name: string;
  list(q: ListQuery): Promise<{ comics: Comic[]; total: number }>;
  trending(): Promise<Comic[]>;
  latestPool(max: number): Promise<Comic[]>;
  quickSearch(title: string, limit: number): Promise<Comic[]>;
  genres(): Promise<Genre[]>;
  comicWithChapters(rawId: string): Promise<{ comic: Comic; chapters: ChapterEntry[] }>;
  chapterPages(rawComicId: string, rawChapterId: string): Promise<string[]>;
}

function ns(providerName: string, rawId: string): string {
  return `${providerName}:${rawId}`;
}
function splitNs(id: string): { provider: string; raw: string } | null {
  const i = id.indexOf(":");
  if (i <= 0) return null;
  return { provider: id.slice(0, i), raw: id.slice(i + 1) };
}

function applySort(comics: Comic[], q: ListQuery): Comic[] {
  if (q.sort === "az") return [...comics].sort((a, b) => a.title.localeCompare(b.title));
  if (q.sort === "rating") return [...comics].sort((a, b) => b.rating - a.rating);
  return comics;
}

// ===========================================================================
// Sanka-format provider (serves both the KomikCast and KomikIndo instances)
// ===========================================================================

interface SankaListItem {
  title: string;
  slug: string;
  image?: string;
  type?: string;
  color?: string | null;
  rating?: string | number;
  chapters?: { title: string; slug: string; date?: string }[];
}
interface SankaListResponse {
  success?: boolean;
  pagination?: { currentPage?: number; totalPages?: number; hasNextPage?: boolean; nextPage?: number | null };
  komikList?: SankaListItem[];
  komikPopuler?: (SankaListItem & { rating?: string | number; author?: string })[];
}

function makeSankaProvider(name: string, base: string): Provider {
  async function sankaGet<T>(path: string): Promise<T> {
    const json = await getJson<T & { success?: boolean }>(`${base}${path}`);
    if (json && json.success === false) throw new Error(`${name} returned success=false: ${path}`);
    return json;
  }

  function mapListItem(raw: SankaListItem): Comic {
    const latestChapterDate = raw.chapters?.[0]?.date;
    return {
      id: ns(name, raw.slug),
      title: cleanTitle(raw.title),
      type: mapType(raw.type),
      // List payloads carry no per-title genre data (detail pages do) —
      // genre browsing is served server-side via /library instead.
      genres: [],
      status: latestChapterDate ? deriveStatusFromIso(relativeIdToIso(latestChapterDate)) : "Ongoing",
      rating: parseRating(raw.rating),
      chapters: 0, // real count only exists on the detail page
      readers: "-",
      desc: "",
      cover: raw.image || null,
    };
  }

  // Accumulating pool pager, same pattern the old client used against
  // Sansekai's paginated /komik/popular: pages are fetched on demand,
  // session-cached by URL (see getJson), and shared across every
  // fetchList call with the same key; a fresh offset-0 call resets the
  // cursor because it means the filters changed. Unlike Sansekai there
  // is no 5-requests/minute budget to protect, but the cap stays as
  // basic politeness toward a community-run instance.
  const MAX_NEW_PAGES_PER_CALL = 6;
  interface Cursor {
    buffer: Comic[];
    nextPage: number;
    exhausted: boolean;
    seenPages: Set<number>;
  }
  const cursors = new Map<string, Cursor>();

  type ListMode =
    | { kind: "search"; query: string }
    | { kind: "library"; genre?: string; type?: ComicType }
    | { kind: "latest" };

  function pagePath(mode: ListMode, page: number): string {
    if (mode.kind === "search") return `/search/${encodeURIComponent(mode.query)}/${page}`;
    if (mode.kind === "library") {
      const params = new URLSearchParams({ page: String(page) });
      if (mode.genre) params.set("genre", mode.genre);
      if (mode.type) params.set("type", mode.type);
      return `/library?${params.toString()}`;
    }
    return `/latest/${page}`;
  }

  async function accumulate(
    key: string,
    mode: ListMode,
    need: number,
  ): Promise<{ buffer: Comic[]; exhausted: boolean }> {
    let cursor = cursors.get(key);
    if (!cursor) {
      cursor = { buffer: [], nextPage: 1, exhausted: false, seenPages: new Set() };
      cursors.set(key, cursor);
    }
    let newFetches = 0;
    while (cursor.buffer.length < need && !cursor.exhausted && newFetches < MAX_NEW_PAGES_PER_CALL) {
      const page = cursor.nextPage;
      const isNew = !cursor.seenPages.has(page);
      const res = await sankaGet<SankaListResponse>(pagePath(mode, page));
      const items = (res.komikList || []).map(mapListItem);
      cursor.buffer.push(...items);
      cursor.seenPages.add(page);
      cursor.nextPage = page + 1;
      const hasNext =
        res.pagination?.hasNextPage ?? (items.length > 0 && page < (res.pagination?.totalPages ?? page));
      if (!hasNext || items.length === 0) cursor.exhausted = true;
      if (isNew) newFetches += 1;
    }
    return { buffer: cursor.buffer, exhausted: cursor.exhausted };
  }

  async function list(q: ListQuery): Promise<{ comics: Comic[]; total: number }> {
    const genre = q.genre && q.genre !== "All" ? q.genre : undefined;
    const type = q.type && q.type !== "All" ? q.type : undefined;
    // Search goes to the search endpoint (which has no genre/type
    // params — results are returned as the server ranks them), filtered
    // browsing goes to /library (genre + type are real server-side
    // filters there, verified live), and unfiltered browsing reads the
    // latest feed. q.status is accepted for interface parity but not
    // filtered on: list payloads carry no reliable status (the old
    // client ignored it too), and detail pages hold the real value.
    const mode: ListMode = q.title
      ? { kind: "search", query: q.title }
      : genre || type
        ? { kind: "library", genre, type }
        : { kind: "latest" };
    const key = `${name}:${mode.kind}:${q.title ?? ""}:${genre ?? ""}:${type ?? ""}`;
    if (q.offset === 0) cursors.delete(key);
    const { buffer, exhausted } = await accumulate(key, mode, q.offset + q.limit);
    let slice = buffer.slice(q.offset, q.offset + q.limit);
    if (q.title && type) slice = slice.filter((c) => c.type === type);
    const comics = applySort(slice, q);
    // Same total semantics as the old client: report what's buffered,
    // plus one more page's worth while the source isn't exhausted, so
    // the pager keeps a "next" alive without inventing a fake count.
    const total = buffer.length + (exhausted ? 0 : q.limit);
    return { comics, total };
  }

  async function trending(): Promise<Comic[]> {
    // The latest feed embeds a `komikPopuler` chart — that's the
    // trending source here (there is no standalone popular endpoint).
    const res = await sankaGet<SankaListResponse>("/latest/1");
    return (res.komikPopuler || []).map(mapListItem);
  }

  async function latestPool(max: number): Promise<Comic[]> {
    const { buffer } = await accumulate(`${name}:pool:latest`, { kind: "latest" }, max);
    return buffer.slice(0, max);
  }

  async function quickSearch(title: string, limit: number): Promise<Comic[]> {
    const res = await sankaGet<SankaListResponse>(`/search/${encodeURIComponent(title)}/1`);
    return (res.komikList || []).slice(0, limit).map(mapListItem);
  }

  async function genres(): Promise<Genre[]> {
    const res = await sankaGet<{ genres?: { name: string; value: string }[] }>("/genres");
    return (res.genres || [])
      .map((g) => ({ title: g.name, slug: g.value }))
      // Explicit-content markers, not browseable genres — same spirit
      // as the old curated list leaving out "mature".
      .filter((g) => g.slug !== "adult" && g.slug !== "mature")
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  interface SankaDetail {
    title: string;
    image?: string;
    rating?: string | number;
    votes?: string;
    description?: string;
    detail?: { status?: string; type?: string };
    genres?: { name: string; slug: string }[];
    chapters?: { title: string; slug: string; releaseTime?: string }[];
  }

  async function comicWithChapters(rawSlug: string): Promise<{ comic: Comic; chapters: ChapterEntry[] }> {
    const res = await sankaGet<{ data: SankaDetail }>(`/detail/${encodeURIComponent(rawSlug)}`);
    const d = res.data;
    const chapters: ChapterEntry[] = (d.chapters || [])
      .map((ch) => ({
        id: ns(name, ch.slug),
        label: cleanTitle(ch.title) || "Chapter",
        chapterNumber: parseChapterNumber(ch.title) ?? parseChapterNumber(ch.slug),
        publishAt: relativeIdToIso(ch.releaseTime),
        readerSlug: rawSlug,
      }))
      .sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
    const votes = parseInt(String(d.votes ?? ""), 10);
    const comic: Comic = {
      // The id stays the slug the list/search handed out (that's what
      // the UI and Firestore keys are built from), not the numeric
      // source id inside the detail payload.
      id: ns(name, rawSlug),
      title: cleanTitle(d.title),
      type: mapType(d.detail?.type),
      genres: (d.genres || []).map((g) => g.name),
      status: mapSankaStatus(d.detail?.status),
      rating: parseRating(d.rating),
      chapters: chapters.length,
      readers: formatCount(Number.isFinite(votes) ? votes : undefined),
      desc: (d.description || "").replace(/\s+/g, " ").trim(),
      cover: d.image || null,
    };
    return { comic, chapters };
  }

  async function chapterPages(_rawComicId: string, rawChapterSlug: string): Promise<string[]> {
    const res = await sankaGet<{ data: { images?: { id: number; url: string }[] } }>(
      `/chapter/${encodeURIComponent(rawChapterSlug)}`,
    );
    return (res.data?.images || [])
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((img) => img.url)
      .filter(Boolean);
  }

  return { name, list, trending, latestPool, quickSearch, genres, comicWithChapters, chapterPages };
}

// ===========================================================================
// MangaDex provider (official API — the always-alive insurance layer)
// ===========================================================================

interface MdManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    description?: Record<string, string>;
    status?: string;
    originalLanguage?: string;
    lastChapter?: string;
    tags?: { attributes: { name: Record<string, string>; group: string } }[];
  };
  relationships?: { type: string; attributes?: { fileName?: string } }[];
}
interface MdListResponse {
  data: MdManga[];
  total: number;
}
interface MdStatsResponse {
  statistics: Record<string, { rating?: { average?: number }; follows?: number }>;
}

const mangadex: Provider = (() => {
  const name = "mangadex";
  // Everything except `pornographic` — mirrors the old source's
  // catalog breadth (the genre chips exclude explicit markers anyway).
  const RATING_PARAMS = "contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica";

  function coverOf(m: MdManga): string | null {
    const rel = (m.relationships || []).find((r) => r.type === "cover_art");
    const file = rel?.attributes?.fileName;
    return file ? `https://uploads.mangadex.org/covers/${m.id}/${file}.512.jpg` : null;
  }

  function typeOf(m: MdManga): ComicType {
    const lang = m.attributes.originalLanguage || "";
    if (lang === "ko") return "Manhwa";
    if (lang.startsWith("zh")) return "Manhua";
    return "Manga";
  }

  function toComic(m: MdManga, stats?: { rating?: { average?: number }; follows?: number }): Comic {
    const a = m.attributes;
    const title = a.title.en || Object.values(a.title)[0] || "";
    const desc = (a.description?.id || a.description?.en || "").replace(/\s+/g, " ").trim();
    const statusMap: Record<string, ComicStatus> = {
      ongoing: "Ongoing",
      completed: "Completed",
      hiatus: "Hiatus",
      cancelled: "Cancelled",
    };
    const lastChapter = parseFloat(a.lastChapter || "");
    return {
      id: ns(name, m.id),
      title,
      type: typeOf(m),
      genres: (a.tags || [])
        .filter((t) => t.attributes.group === "genre")
        .map((t) => t.attributes.name.en)
        .filter(Boolean),
      status: statusMap[a.status || ""] || "Ongoing",
      rating: parseRating(stats?.rating?.average),
      chapters: Number.isFinite(lastChapter) ? Math.floor(lastChapter) : 0,
      readers: formatCount(stats?.follows),
      desc,
      cover: coverOf(m),
    };
  }

  async function withStats(list: MdManga[]): Promise<Comic[]> {
    if (list.length === 0) return [];
    const ids = list.map((m) => `ids[]=${encodeURIComponent(m.id)}`).join("&");
    const stats = await getJson<MdStatsResponse>(`${MANGADEX_BASE}/statistics/manga?${ids}`);
    return list.map((m) => toComic(m, stats.statistics?.[m.id]));
  }

  // Genre chips use Sanka slugs; MangaDex tags are UUIDs, resolved once
  // per session by slugified English name.
  let tagIdBySlug: Map<string, string> | null = null;
  async function resolveTagId(slug: string): Promise<string | null> {
    if (!tagIdBySlug) {
      const res = await getJson<{ data: { id: string; attributes: { name: Record<string, string> } }[] }>(
        `${MANGADEX_BASE}/manga/tag`,
      );
      tagIdBySlug = new Map(
        (res.data || []).map((t) => [slugify(t.attributes.name.en || ""), t.id] as [string, string]),
      );
    }
    return tagIdBySlug.get(slug) ?? null;
  }

  function orderParam(sort: ListQuery["sort"]): string {
    if (sort === "az") return "order[title]=asc";
    if (sort === "rating") return "order[followedCount]=desc";
    return "order[updatedAt]=desc";
  }

  async function list(q: ListQuery): Promise<{ comics: Comic[]; total: number }> {
    const params = new URLSearchParams();
    params.set("limit", String(q.limit));
    params.set("offset", String(q.offset));
    params.set("includes[]", "cover_art");
    // Browsing (no title) is limited to titles that actually have
    // Indonesian chapters — an Indo reader app gains nothing from
    // listing the other 88k titles it can't serve chapters for.
    if (!q.title) params.append("availableTranslatedLanguage[]", "id");
    if (q.title) params.set("title", q.title);
    if (q.type && q.type !== "All") {
      const lang = q.type === "Manhwa" || q.type === "Webtoon" ? "ko" : q.type === "Manhua" ? "zh" : "ja";
      params.append("originalLanguage[]", lang);
    }
    const res = await getJson<MdListResponse>(
      `${MANGADEX_BASE}/manga?${params.toString()}&${RATING_PARAMS}&${orderParam(q.sort)}`,
    );
    let comics = await withStats(res.data || []);
    if (q.genre && q.genre !== "All") {
      const tagId = await resolveTagId(q.genre);
      if (tagId) {
        // Re-query with the tag rather than filtering this page
        // client-side (which would return nearly-empty pages).
        const tagged = new URLSearchParams(params);
        tagged.append("includedTags[]", tagId);
        tagged.set("includedTagsMode", "AND");
        const res2 = await getJson<MdListResponse>(
          `${MANGADEX_BASE}/manga?${tagged.toString()}&${RATING_PARAMS}&${orderParam(q.sort)}`,
        );
        comics = await withStats(res2.data || []);
        return { comics, total: res2.total ?? comics.length };
      }
      comics = comics.filter((c) => c.genres.some((g) => slugify(g) === q.genre));
    }
    return { comics, total: res.total ?? comics.length };
  }

  async function trending(): Promise<Comic[]> {
    const res = await getJson<MdListResponse>(
      `${MANGADEX_BASE}/manga?limit=30&offset=0&includes[]=cover_art&availableTranslatedLanguage[]=id&${RATING_PARAMS}&order[followedCount]=desc`,
    );
    return withStats(res.data || []);
  }

  async function latestPool(max: number): Promise<Comic[]> {
    const res = await getJson<MdListResponse>(
      `${MANGADEX_BASE}/manga?limit=${Math.min(max, 100)}&offset=0&includes[]=cover_art&availableTranslatedLanguage[]=id&${RATING_PARAMS}&order[updatedAt]=desc`,
    );
    return withStats(res.data || []);
  }

  async function quickSearch(title: string, limit: number): Promise<Comic[]> {
    const res = await getJson<MdListResponse>(
      `${MANGADEX_BASE}/manga?title=${encodeURIComponent(title)}&limit=${limit}&offset=0&includes[]=cover_art&${RATING_PARAMS}&order[relevance]=desc`,
    );
    return withStats(res.data || []);
  }

  async function genres(): Promise<Genre[]> {
    const res = await getJson<{ data: { attributes: { name: Record<string, string>; group: string } }[] }>(
      `${MANGADEX_BASE}/manga/tag`,
    );
    return (res.data || [])
      .filter((t) => t.attributes.group === "genre")
      .map((t) => ({ title: t.attributes.name.en, slug: slugify(t.attributes.name.en) }))
      .filter((g) => g.title)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  interface MdChapter {
    id: string;
    attributes: {
      chapter: string | null;
      title: string | null;
      publishAt: string;
      translatedLanguage: string;
    };
  }

  async function fetchChapterSet(mangaUuid: string, indonesianOnly: boolean): Promise<MdChapter[]> {
    const all: MdChapter[] = [];
    const PAGE = 100;
    const MAX_PAGES = 5; // cap: 500 chapter entries per title
    for (let p = 0; p < MAX_PAGES; p++) {
      const lang = indonesianOnly ? "&translatedLanguage[]=id" : "";
      const res = await getJson<{ data: MdChapter[]; total: number }>(
        `${MANGADEX_BASE}/chapter?manga=${mangaUuid}&limit=${PAGE}&offset=${p * PAGE}&order[chapter]=desc${lang}`,
      );
      all.push(...(res.data || []));
      if (all.length >= (res.total ?? 0) || (res.data || []).length < PAGE) break;
    }
    return all;
  }

  async function comicWithChapters(rawId: string): Promise<{ comic: Comic; chapters: ChapterEntry[] }> {
    const [mangaRes, statsRes] = await Promise.all([
      getJson<{ data: MdManga }>(`${MANGADEX_BASE}/manga/${rawId}?includes[]=cover_art`),
      getJson<MdStatsResponse>(`${MANGADEX_BASE}/statistics/manga?ids[]=${encodeURIComponent(rawId)}`),
    ]);
    const comic = toComic(mangaRes.data, statsRes.statistics?.[rawId]);
    // Indonesian chapters first; titles without any fall back to every
    // language (dedupe prefers Indonesian, then English, per chapter).
    let raw = await fetchChapterSet(rawId, true);
    if (raw.length === 0) raw = await fetchChapterSet(rawId, false);
    const langRank = (lang: string): number => (lang === "id" ? 0 : lang === "en" ? 1 : 2);
    const byKey = new Map<string, MdChapter>();
    for (const ch of [...raw].sort((a, b) => langRank(a.attributes.translatedLanguage) - langRank(b.attributes.translatedLanguage))) {
      const key = ch.attributes.chapter ?? ch.id;
      if (!byKey.has(key)) byKey.set(key, ch);
    }
    const chapters: ChapterEntry[] = [...byKey.values()]
      .map((ch) => {
        const num = ch.attributes.chapter ? parseFloat(ch.attributes.chapter) : null;
        return {
          id: ns(name, ch.id),
          label: num !== null && Number.isFinite(num) ? `Chapter ${num}` : ch.attributes.title || "Oneshot",
          chapterNumber: num !== null && Number.isFinite(num) ? num : null,
          publishAt: ch.attributes.publishAt,
          readerSlug: rawId,
        };
      })
      .sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
    comic.chapters = chapters.length;
    return { comic, chapters };
  }

  async function chapterPages(_rawComicId: string, rawChapterId: string): Promise<string[]> {
    const res = await getJson<{ baseUrl: string; chapter: { hash: string; data: string[] } }>(
      `${MANGADEX_BASE}/at-home/server/${rawChapterId}`,
    );
    return (res.chapter?.data || []).map((f) => `${res.baseUrl}/data/${res.chapter.hash}/${f}`);
  }

  return { name, list, trending, latestPool, quickSearch, genres, comicWithChapters, chapterPages };
})();

// ===========================================================================
// Facade — priority order + health-based failover (discovery calls only)
// ===========================================================================

const sankaKomikcast = makeSankaProvider("sanka-komikcast", SANKA_KOMIKCAST_BASE);
const sankaKomikindo = makeSankaProvider("sanka-komikindo", SANKA_KOMIKINDO_BASE);
const PROVIDERS: Provider[] = [sankaKomikcast, sankaKomikindo, mangadex];
const PROVIDER_BY_NAME = new Map(PROVIDERS.map((p) => [p.name, p]));

const DOWN_COOLDOWN_MS = 60_000;
const downUntil = new Map<string, number>();
function isDown(p: Provider): boolean {
  return (downUntil.get(p.name) ?? 0) > Date.now();
}
function markDown(p: Provider): void {
  downUntil.set(p.name, Date.now() + DOWN_COOLDOWN_MS);
}

async function discover<T>(fn: (p: Provider) => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  // Healthy providers first, in priority order; if every provider is in
  // cooldown, fall through and try them all anyway (a stale "down" mark
  // must never be the reason the app shows nothing).
  for (const pass of [false, true]) {
    for (const p of PROVIDERS) {
      if (isDown(p) !== pass) continue;
      try {
        return await fn(p);
      } catch (err) {
        markDown(p);
        lastError = err;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All comic providers are unreachable right now — please try again in a moment.");
}

export async function fetchList(q: ListQuery): Promise<{ comics: Comic[]; total: number }> {
  return discover((p) => p.list(q));
}

export async function fetchTrendingAllTime(): Promise<Comic[]> {
  return discover((p) => p.trending());
}

export async function fetchLatestPool(max: number): Promise<Comic[]> {
  return discover((p) => p.latestPool(max));
}

export async function quickSearch(title: string, limit = 8): Promise<Comic[]> {
  if (!title.trim()) return [];
  return discover((p) => p.quickSearch(title, limit));
}

export async function fetchGenres(): Promise<Genre[]> {
  // Union of both Sanka genre lists (their catalogs overlap but neither
  // is a superset); MangaDex tags only if both Sanka instances are down.
  const merged = new Map<string, Genre>();
  let anySanka = false;
  for (const p of [sankaKomikcast, sankaKomikindo]) {
    try {
      for (const g of await p.genres()) {
        const prev = merged.get(g.slug);
        // Prefer the properly-capitalized display name when instances
        // disagree ("Apocalypse" over "apocalypse").
        if (!prev || (prev.title === prev.title.toLowerCase() && g.title !== g.title.toLowerCase())) {
          merged.set(g.slug, g);
        }
      }
      anySanka = true;
    } catch {
      markDown(p);
    }
  }
  if (anySanka) return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title));
  return mangadex.genres();
}

// Detail/chapter routing: the namespaced id names the owning provider —
// content is never fetched from a different provider than the one that
// listed it. Unprefixed ids are pre-refactor bookmarks; guess Sanka
// (KomikCast first, then KomikIndo) since those catalogs use slugs.
export async function fetchComicWithChapters(
  mangaId: string,
): Promise<{ comic: Comic; chapters: ChapterEntry[] }> {
  const parsed = splitNs(mangaId);
  const owner = parsed ? PROVIDER_BY_NAME.get(parsed.provider) : undefined;
  if (parsed && owner) return owner.comicWithChapters(parsed.raw);
  const raw = parsed ? parsed.raw : mangaId;
  let lastError: unknown = null;
  for (const p of [sankaKomikcast, sankaKomikindo]) {
    try {
      return await p.comicWithChapters(raw);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Comic not found: ${mangaId}`);
}

export async function fetchChapterPages(mangaId: string, chapterId: string): Promise<string[]> {
  // The chapter id's prefix is authoritative; fall back to the comic
  // id's prefix, then to the legacy slug guess.
  for (const id of [chapterId, mangaId]) {
    const parsed = splitNs(id);
    const owner = parsed ? PROVIDER_BY_NAME.get(parsed.provider) : undefined;
    if (parsed && owner) {
      return owner.chapterPages(splitNs(mangaId)?.raw ?? mangaId, parsed.raw);
    }
  }
  const rawChapter = splitNs(chapterId)?.raw ?? chapterId;
  const rawComic = splitNs(mangaId)?.raw ?? mangaId;
  let lastError: unknown = null;
  for (const p of [sankaKomikcast, sankaKomikindo]) {
    try {
      return await p.chapterPages(rawComic, rawChapter);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Chapter not found: ${chapterId}`);
}
