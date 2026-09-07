import type { ChapterEntry, Comic, ComicStatus, ComicType } from "./types";

// Self-hosted fork of VernSG/Komiku-Rest-Api (scrapes komiku.org), deployed
// separately from this app. Already sends Access-Control-Allow-Origin: *,
// so the browser can call it directly — no same-origin proxy needed the way
// MangaDex required one.
const API_BASE =
  (import.meta.env.VITE_KOMIKU_API_BASE as string) || "https://komiku-rest-api-selfhost.vercel.app";

// The API's own /image-proxy re-fetches komiku.* CDN images server-side
// (with a host allowlist) and hands back a same-origin-friendly stream.
function proxiedImage(url: string | null | undefined): string | null {
  return url ? `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}` : null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`Komiku API request failed (${res.status}): ${path}`);
  return (await res.json()) as T;
}

function deriveType(raw: string | undefined): ComicType {
  const t = (raw || "").toLowerCase();
  if (t.includes("manhwa")) return "Manhwa";
  if (t.includes("manhua")) return "Manhua";
  return "Manga";
}

function deriveStatus(raw: string | undefined): ComicStatus {
  const s = (raw || "").toLowerCase();
  if (s.includes("tamat") || s.includes("complete") || s.includes("end")) return "Completed";
  if (s.includes("hiatus")) return "Hiatus";
  return "Ongoing";
}

// Komiku's HTML has no rating widget for this scraper to pick up, unlike
// MangaDex's /statistics endpoint — every comic reports 0 here.
const NO_RATING = 0;

function stripDetailPrefix(path: string | null | undefined): string {
  if (!path) return "";
  return path.replace(/^\/detail-komik\//, "").replace(/\/+$/, "");
}

// The different listing endpoints (pustaka/genre/populer/terbaru/search)
// each shape their card objects slightly differently — this covers every
// field any of them uses to identify or link to a manga.
interface KomikuCard {
  title: string;
  originalLink?: string | null;
  url?: string | null;
  thumbnail?: string | null;
  type?: string;
  slug?: string;
  mangaSlug?: string;
  detailUrl?: string | null;
  apiDetailLink?: string | null;
  apiMangaLink?: string | null;
  href?: string;
  description?: string;
  readers?: string;
}

function slugFromCard(item: KomikuCard): string {
  return (
    item.slug ||
    item.mangaSlug ||
    stripDetailPrefix(item.apiDetailLink || item.detailUrl || item.apiMangaLink || item.href) ||
    (item.url || item.originalLink || "").match(/\/manga\/([^/]+)/)?.[1] ||
    ""
  );
}

function toComicFromCard(item: KomikuCard): Comic {
  return {
    id: slugFromCard(item),
    title: item.title || "Untitled",
    type: deriveType(item.type),
    genres: [],
    status: "Ongoing",
    rating: NO_RATING,
    chapters: 0,
    readers: item.readers || "-",
    desc: item.description || "",
    cover: proxiedImage(item.thumbnail),
  };
}

interface KomikuChapterRaw {
  title: string;
  apiLink: string | null;
  chapterNumber: string;
  date: string;
}
interface KomikuDetail {
  title: string;
  description: string;
  sinopsis: string;
  thumbnail: string | null;
  info: Record<string, string>;
  genres: string[];
  slug: string;
  chapters: KomikuChapterRaw[];
}

// Komiku's chapter dates are DD/MM/YYYY (Indonesian format); everywhere
// else in the app expects an ISO string it can hand to `new Date()`.
function parseKomikuDate(raw: string | undefined): string {
  const m = (raw || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return new Date().toISOString();
  const [, d, mo, y] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d)).toISOString();
}

export async function fetchMangaDetail(slug: string): Promise<Comic> {
  const d = await getJson<KomikuDetail>(`/detail-komik/${slug}`);
  return {
    id: d.slug || slug,
    title: d.title,
    type: deriveType(d.info?.Tipe),
    genres: d.genres || [],
    status: deriveStatus(d.info?.Status),
    rating: NO_RATING,
    chapters: (d.chapters || []).length,
    readers: "-",
    desc: d.description || d.sinopsis || "",
    cover: proxiedImage(d.thumbnail),
  };
}

// Extracts the manga slug a chapter is actually served under from its own
// /baca-chapter/<slug>/<number> link — see the ChapterEntry.readerSlug note.
function readerSlugFromChapterLink(apiLink: string | null, fallback: string): string {
  return apiLink?.match(/^\/baca-chapter\/([^/]+)\//)?.[1] || fallback;
}

export async function fetchChapters(mangaId: string): Promise<ChapterEntry[]> {
  const d = await getJson<KomikuDetail>(`/detail-komik/${mangaId}`);
  return (d.chapters || [])
    .filter((ch) => ch.chapterNumber)
    .map((ch) => {
      const num = Number.parseFloat(ch.chapterNumber);
      return {
        id: ch.chapterNumber,
        label: Number.isFinite(num) ? `Chapter ${num}` : ch.title || "Chapter",
        chapterNumber: Number.isFinite(num) ? num : null,
        publishAt: parseKomikuDate(ch.date),
        readerSlug: readerSlugFromChapterLink(ch.apiLink, mangaId),
      };
    });
}

export async function fetchChapterPages(mangaId: string, chapterId: string): Promise<string[]> {
  const d = await getJson<{ images: { src: string }[] }>(`/baca-chapter/${mangaId}/${chapterId}`);
  return (d.images || [])
    .map((img) => proxiedImage(img.src))
    .filter((u): u is string => Boolean(u));
}

export interface ListQuery {
  offset: number;
  limit: number;
  sort: "latest" | "rating" | "az";
  type?: ComicType | "All";
  genre?: string | "All";
  status?: ComicStatus | "All";
  title?: string;
}

function filterByType(comics: Comic[], q: ListQuery): Comic[] {
  return q.type && q.type !== "All" ? comics.filter((c) => c.type === q.type) : comics;
}
function applySort(comics: Comic[], q: ListQuery): Comic[] {
  return q.sort === "az" ? [...comics].sort((a, b) => a.title.localeCompare(b.title)) : comics;
}

// Komiku's /pustaka and /genre pages come back at a fixed ~10 raw items per
// page, *before* our own type filter runs — a type filter on a mixed page
// can otherwise leave a "page" with only 2 or 3 cards on it. To always fill
// a full page, matching items are accumulated across as many underlying
// pages as it takes (up to a cap), cached per filter combo so paging
// forward/back doesn't re-fetch pages already seen.
interface ListCursor {
  buffer: Comic[];
  nextRealPage: number;
  exhausted: boolean;
}
const listCursors = new Map<string, ListCursor>();
const MAX_UNDERLYING_FETCHES = 8;
// Underlying pages are fetched a batch at a time (instead of one await per
// round-trip) since Komiku pages are independently addressable by number —
// this cut a 5-round-trip type-filter fetch from ~5 sequential latencies to
// ~2 parallel rounds. Pages fetched past the real last page just come back
// empty and are safely discarded once `hasMore: false` is seen.
const BATCH_SIZE = 4;

async function accumulate(
  key: string,
  need: number,
  fetchRealPage: (realPage: number) => Promise<{ items: Comic[]; hasMore: boolean }>,
): Promise<ListCursor> {
  let cursor = listCursors.get(key);
  if (!cursor) {
    cursor = { buffer: [], nextRealPage: 1, exhausted: false };
    listCursors.set(key, cursor);
  }
  let fetches = 0;
  while (cursor.buffer.length < need && !cursor.exhausted && fetches < MAX_UNDERLYING_FETCHES) {
    const batchCount = Math.min(BATCH_SIZE, MAX_UNDERLYING_FETCHES - fetches);
    const startPage = cursor.nextRealPage;
    const results = await Promise.all(
      Array.from({ length: batchCount }, (_, i) => fetchRealPage(startPage + i)),
    );
    for (const { items, hasMore } of results) {
      if (cursor.exhausted) break;
      cursor.buffer.push(...items);
      cursor.nextRealPage += 1;
      if (!hasMore) cursor.exhausted = true;
    }
    fetches += batchCount;
  }
  return cursor;
}

export async function fetchList(q: ListQuery): Promise<{ comics: Comic[]; total: number }> {
  // Search has no page parameter on Komiku's side — it's always a single
  // fixed batch, so there's nothing further to accumulate.
  if (q.title) {
    const json = await getJson<{ data: KomikuCard[] }>(`/search?q=${encodeURIComponent(q.title)}`);
    const comics = filterByType(json.data.map(toComicFromCard), q);
    return { comics: applySort(comics.slice(q.offset, q.offset + q.limit), q), total: q.offset + comics.length };
  }

  const isGenre = Boolean(q.genre && q.genre !== "All");
  const key = `${isGenre ? `genre:${q.genre}` : "pustaka"}:${q.type ?? "All"}`;
  // A page-1 request means the filters just changed (or the user paged back
  // to the start) — drop any stale accumulation so results match the
  // current filters instead of a previous browse.
  if (q.offset === 0) listCursors.delete(key);

  const fetchRealPage = isGenre
    ? async (realPage: number) => {
        const json = await getJson<{ data: KomikuCard[]; hasNextPage: boolean }>(
          `/genre/${q.genre}/page/${realPage}`,
        );
        return { items: filterByType(json.data.map(toComicFromCard), q), hasMore: json.hasNextPage };
      }
    : async (realPage: number) => {
        const json = await getJson<{ results: KomikuCard[] }>(`/pustaka/page/${realPage}`);
        return { items: filterByType(json.results.map(toComicFromCard), q), hasMore: json.results.length >= 10 };
      };

  const cursor = await accumulate(key, q.offset + q.limit, fetchRealPage);
  const comics = applySort(cursor.buffer.slice(q.offset, q.offset + q.limit), q);
  const total = cursor.buffer.length + (cursor.exhausted ? 0 : q.limit);
  return { comics, total };
}

// "All-time trending" has no single Komiku endpoint with enough items to
// paginate on its own — /rekomendasi alone is under 10 titles — so this
// merges it with every /komik-populer type section and dedupes by id.
export async function fetchTrendingAllTime(): Promise<Comic[]> {
  const [recommended, populer] = await Promise.all([
    getJson<KomikuCard[]>("/rekomendasi"),
    getJson<{ manga: { items: KomikuCard[] }; manhwa: { items: KomikuCard[] }; manhua: { items: KomikuCard[] } }>(
      "/komik-populer",
    ),
  ]);
  const seen = new Set<string>();
  const merged: Comic[] = [];
  for (const item of [
    ...recommended,
    ...populer.manga.items,
    ...populer.manhwa.items,
    ...populer.manhua.items,
  ]) {
    const comic = toComicFromCard(item);
    if (comic.id && !seen.has(comic.id)) {
      seen.add(comic.id);
      merged.push(comic);
    }
  }
  return merged;
}

export async function fetchLatestPool(max: number): Promise<Comic[]> {
  const json = await getJson<KomikuCard[]>("/terbaru");
  return json.slice(0, max).map(toComicFromCard);
}

export async function quickSearch(title: string, limit = 8): Promise<Comic[]> {
  if (!title.trim()) return [];
  const json = await getJson<{ data: KomikuCard[] }>(`/search?q=${encodeURIComponent(title)}`);
  return json.data.slice(0, limit).map(toComicFromCard);
}

export interface Genre {
  title: string;
  slug: string;
}

// Komiku's own genre list, minus explicit/adult-content tags (this is a
// browsable genre list, not an explicit-content finder), a few garbled or
// duplicate scrape artifacts (e.g. both "martial-art" and "martial-arts"
// exist as separate tags for the same genre), and tags confirmed dead —
// checked directly against /genre/<slug>/page/1 for every tag Komiku
// lists; these returned zero manga despite being real, listed genres.
const EXCLUDED_GENRE_SLUGS = new Set([
  "adult",
  "ecchi",
  "hentai",
  "smut",
  "sexual-violence",
  "shotacon",
  "mature",
  "martial-art",
  "one-shot",
  "shoujog",
  "mangatoon",
  "4-koma",
  "adaptation",
  "businessman",
  "kids",
  "magical-girls",
  "modern",
  "office-workers",
  "web-comic",
  "xianxia",
  "xuanhuan",
]);

let genresCache: Genre[] | null = null;

export async function fetchGenres(): Promise<Genre[]> {
  if (genresCache) return genresCache;
  const json = await getJson<{ title: string; slug: string }[]>("/genre-all");
  genresCache = json
    .filter((g) => g.slug && !EXCLUDED_GENRE_SLUGS.has(g.slug))
    .map((g) => ({ slug: g.slug, title: g.title.replace(/\s*\(\d[\d.]*\)\s*$/, "") }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return genresCache;
}
