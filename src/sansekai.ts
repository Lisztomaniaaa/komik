import type { ChapterEntry, Comic, ComicStatus, ComicType } from "./types";

// Client for the Sansekai API (https://api.sansekai.my.id) — replaces the
// self-hosted Komiku scraper fork this file used to talk to, which had
// gone mostly dead (many endpoints timing out / erroring). Sansekai is a
// real hosted API (not a scraper we run ourselves) with a documented
// Swagger UI at the API root, and it already sends
// Access-Control-Allow-Origin: * so the browser can call it directly.
const API_BASE = (import.meta.env.VITE_SANSEKAI_API_BASE as string) || "https://api.sansekai.my.id/api";

// The free tier is rate-limited to 5 requests/minute PER CLIENT (seen via
// the `ratelimit-limit: 5;w=60` response header — Cloudflare-enforced,
// not documented in the Swagger UI). Every fetching strategy below is
// built around that scarcity: identical requests are deduped/cached
// forever for the life of the page (see `getJson`), and the comic pool
// used for browsing/genre/trending is fetched one page at a time and
// shared across every feature that needs it (see `popularPageCache`)
// instead of each feature pulling its own pages.
interface SansekaiEnvelope<T> {
  retcode: number;
  message: string;
  meta?: { page?: number; page_size?: number; total_page?: number; total_record?: number };
  data: T;
}

const requestCache = new Map<string, Promise<unknown>>();
async function getJson<T>(path: string): Promise<T> {
  let pending = requestCache.get(path);
  if (!pending) {
    pending = fetch(`${API_BASE}${path}`).then(async (res) => {
      if (res.status === 429) {
        throw new Error("Sansekai API is rate-limited right now (free tier: 5 requests/minute) — please wait a moment and try again.");
      }
      if (!res.ok) throw new Error(`Sansekai API request failed (${res.status}): ${path}`);
      const json = await res.json();
      if (json && typeof json.retcode === "number" && json.retcode !== 0) {
        throw new Error(json.message || "Sansekai API returned an error");
      }
      return json;
    });
    requestCache.set(path, pending);
    // Don't cache failures — a transient rate-limit error shouldn't poison
    // every future attempt at the same path for the rest of the session.
    pending.catch(() => requestCache.delete(path));
  }
  return pending as Promise<T>;
}

interface SansekaiTaxonomyTag {
  slug: string;
  name: string;
}
interface SansekaiTaxonomy {
  Format?: SansekaiTaxonomyTag[];
  Genre?: SansekaiTaxonomyTag[];
  Type?: SansekaiTaxonomyTag[];
  Author?: SansekaiTaxonomyTag[];
  Artist?: SansekaiTaxonomyTag[];
}
// Shape shared by every comic Sansekai hands back, whether from a listing
// endpoint (popular/latest/recommended/search) or /komik/detail.
interface SansekaiComicRaw {
  manga_id: string;
  title: string;
  description?: string | null;
  cover_image_url?: string | null;
  cover_portrait_url?: string | null;
  view_count?: number;
  user_rate?: number;
  latest_chapter_number?: number;
  latest_chapter_time?: string;
  taxonomy?: SansekaiTaxonomy;
}

function deriveType(raw: string | undefined): ComicType {
  const t = (raw || "").toLowerCase();
  if (t.includes("manhwa")) return "Manhwa";
  if (t.includes("manhua")) return "Manhua";
  return "Manga";
}

// Sansekai has no explicit Ongoing/Completed/Hiatus field (unlike Komiku's
// scraped status text) — the closest signal it exposes is how recently a
// title got a new chapter, so that's used as a heuristic instead.
const HIATUS_AFTER_MS = 1000 * 60 * 60 * 24 * 180;
function deriveStatus(latestChapterTime: string | undefined): ComicStatus {
  if (!latestChapterTime) return "Ongoing";
  const t = Date.parse(latestChapterTime);
  if (Number.isNaN(t)) return "Ongoing";
  return Date.now() - t > HIATUS_AFTER_MS ? "Hiatus" : "Ongoing";
}

// Unlike Komiku (no rating data at all, see the old NO_RATING), Sansekai
// reports a real 0-10 user_rate per title.
function deriveRating(userRate: number | undefined): number {
  if (typeof userRate !== "number" || Number.isNaN(userRate)) return 0;
  return Math.round(userRate * 10) / 10;
}

function formatCount(n: number | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

// Comic.genres stores display names (for the UI chips), but filtering
// needs the machine-readable slugs Sansekai groups titles by — kept here
// rather than on Comic itself since nothing outside this module needs it.
const genreSlugsByComicId = new Map<string, string[]>();

function toComic(raw: SansekaiComicRaw): Comic {
  const genreTags = raw.taxonomy?.Genre ?? [];
  genreSlugsByComicId.set(raw.manga_id, genreTags.map((g) => g.slug));
  return {
    id: raw.manga_id,
    title: raw.title,
    type: deriveType(raw.taxonomy?.Format?.[0]?.name),
    genres: genreTags.map((g) => g.name),
    status: deriveStatus(raw.latest_chapter_time),
    rating: deriveRating(raw.user_rate),
    chapters: raw.latest_chapter_number ?? 0,
    readers: formatCount(raw.view_count),
    desc: raw.description || "",
    cover: raw.cover_portrait_url || raw.cover_image_url || null,
  };
}

interface SansekaiChapterRaw {
  chapter_id: string;
  chapter_title?: string;
  chapter_number: number;
  release_date: string;
}

// Sansekai splits what Komiku served as one scraped page into two
// endpoints (detail + chapterlist) — unlike the old fetchComicWithChapters
// comment, there's no way to fold this back into a single request here.
export async function fetchComicWithChapters(
  mangaId: string,
): Promise<{ comic: Comic; chapters: ChapterEntry[] }> {
  const [detailRes, chaptersRes] = await Promise.all([
    getJson<SansekaiEnvelope<SansekaiComicRaw>>(`/komik/detail?manga_id=${encodeURIComponent(mangaId)}`),
    getJson<SansekaiEnvelope<SansekaiChapterRaw[]>>(`/komik/chapterlist?manga_id=${encodeURIComponent(mangaId)}`),
  ]);
  const comic = toComic(detailRes.data);
  const chapters: ChapterEntry[] = (chaptersRes.data || [])
    .map((ch) => ({
      id: ch.chapter_id,
      label: Number.isFinite(ch.chapter_number) ? `Chapter ${ch.chapter_number}` : ch.chapter_title || "Chapter",
      chapterNumber: Number.isFinite(ch.chapter_number) ? ch.chapter_number : null,
      publishAt: ch.release_date,
      // Sansekai's reader only needs the chapter_id (see fetchChapterPages)
      // — no per-chapter slug mismatch like Komiku had — this is kept only
      // because ChapterEntry/openReader's call signature expects it.
      readerSlug: mangaId,
    }))
    .sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  comic.chapters = chapters.length;
  return { comic, chapters };
}

export async function fetchChapterPages(_mangaId: string, chapterId: string): Promise<string[]> {
  const res = await getJson<SansekaiEnvelope<{ chapter: { data: string[] } }>>(
    `/komik/getimage?chapter_id=${encodeURIComponent(chapterId)}`,
  );
  return res.data.chapter?.data ?? [];
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
function filterByGenre(comics: Comic[], q: ListQuery): Comic[] {
  if (!q.genre || q.genre === "All") return comics;
  return comics.filter((c) => (genreSlugsByComicId.get(c.id) ?? []).includes(q.genre as string));
}
function applySort(comics: Comic[], q: ListQuery): Comic[] {
  return q.sort === "az" ? [...comics].sort((a, b) => a.title.localeCompare(b.title)) : comics;
}

// Sansekai's ONLY endpoint with real server-side pagination is
// /komik/popular (100 pages x 10 items) — /komik/latest, /komik/recommended
// and /komik/search all ignore any page param and just return one fixed
// batch. So this pool doubles as the source for Explore, genre browsing,
// AND all-time trending; every page fetched here is cached by page number
// forever, independent of which feature or filter asked for it, so
// switching genre/type filters back and forth after the relevant pages
// have already been seen costs zero extra requests.
const POPULAR_PAGE_SIZE = 10;
const popularPageCache = new Map<number, Promise<{ items: Comic[]; hasMore: boolean }>>();
function fetchPopularRealPage(page: number): Promise<{ items: Comic[]; hasMore: boolean }> {
  let pending = popularPageCache.get(page);
  if (!pending) {
    pending = getJson<SansekaiEnvelope<SansekaiComicRaw[]>>(`/komik/popular?page=${page}`).then((json) => ({
      items: (json.data || []).map(toComic),
      hasMore: page < (json.meta?.total_page ?? page),
    }));
    popularPageCache.set(page, pending);
    pending.catch(() => popularPageCache.delete(page));
  }
  return pending;
}

interface ListCursor {
  buffer: Comic[];
  nextRealPage: number;
  exhausted: boolean;
}
const listCursors = new Map<string, ListCursor>();
// Old Komiku code allowed up to 8 underlying page fetches (4 at a time in
// parallel) per accumulate() call, because that scraper had no real rate
// limit. Sansekai's whole budget is 5 requests/minute, so this caps how
// many genuinely NEW pages (i.e. not already in popularPageCache) a single
// accumulate() call is allowed to pull — pages already cached from earlier
// browsing don't count against this and are always reused.
const MAX_NEW_PAGES_PER_CALL = 4;

async function accumulate(
  key: string,
  need: number,
  matches: (c: Comic) => boolean,
): Promise<ListCursor> {
  let cursor = listCursors.get(key);
  if (!cursor) {
    cursor = { buffer: [], nextRealPage: 1, exhausted: false };
    listCursors.set(key, cursor);
  }
  let newFetches = 0;
  while (cursor.buffer.length < need && !cursor.exhausted && newFetches < MAX_NEW_PAGES_PER_CALL) {
    const isNewPage = !popularPageCache.has(cursor.nextRealPage);
    const { items, hasMore } = await fetchPopularRealPage(cursor.nextRealPage);
    cursor.buffer.push(...items.filter(matches));
    cursor.nextRealPage += 1;
    if (!hasMore) cursor.exhausted = true;
    if (isNewPage) newFetches += 1;
  }
  return cursor;
}

export async function fetchList(q: ListQuery): Promise<{ comics: Comic[]; total: number }> {
  // /komik/search ignores its own page param and always returns the same
  // fixed batch (max ~10) — there's nothing further to accumulate, so the
  // filtered, sorted result IS the full result set.
  if (q.title) {
    const json = await getJson<SansekaiEnvelope<SansekaiComicRaw[]>>(
      `/komik/search?query=${encodeURIComponent(q.title)}`,
    );
    let comics = (json.data || []).map(toComic);
    comics = applySort(filterByGenre(filterByType(comics, q), q), q);
    return { comics: comics.slice(q.offset, q.offset + q.limit), total: comics.length };
  }

  const genre = q.genre && q.genre !== "All" ? q.genre : null;
  const key = `${genre ?? "all"}:${q.type ?? "All"}`;
  // A page-1 request means the filters just changed (or the user paged
  // back to the start) — drop the stale accumulation bookkeeping so
  // results match the current filters. The underlying pages stay cached
  // in popularPageCache, so re-accumulating from page 1 here is free.
  if (q.offset === 0) listCursors.delete(key);

  const matches = (c: Comic): boolean => {
    if (q.type && q.type !== "All" && c.type !== q.type) return false;
    if (genre && !(genreSlugsByComicId.get(c.id) ?? []).includes(genre)) return false;
    return true;
  };

  const cursor = await accumulate(key, q.offset + q.limit, matches);
  const comics = applySort(cursor.buffer.slice(q.offset, q.offset + q.limit), q);
  const total = cursor.buffer.length + (cursor.exhausted ? 0 : q.limit);
  return { comics, total };
}

// "Top trending" reuses the same popular pool as unfiltered Explore/genre
// browsing (via the shared popularPageCache), just fetched once up front
// as its own accumulation — 3 pages/30 titles is a fixed, one-time cost
// per session rather than trying to match how many the old Komiku merge
// (rekomendasi + 3x komik-populer) happened to return.
const TRENDING_POOL_TARGET = POPULAR_PAGE_SIZE * 3;
export async function fetchTrendingAllTime(): Promise<Comic[]> {
  const cursor = await accumulate("trending", TRENDING_POOL_TARGET, () => true);
  return cursor.buffer.slice(0, TRENDING_POOL_TARGET);
}

// /komik/latest ignores paging too (always the same fixed batch per
// `type`), and its `type` param means "project" vs "mirror" source, not
// Manga/Manhwa/Manhua — nothing to paginate, so both source pools are
// fetched once, merged, deduped and cached for the rest of the session.
let latestPoolPromise: Promise<Comic[]> | null = null;
function fetchLatestRawPool(): Promise<Comic[]> {
  if (!latestPoolPromise) {
    latestPoolPromise = Promise.all([
      getJson<SansekaiEnvelope<SansekaiComicRaw[]>>("/komik/latest?type=project"),
      getJson<SansekaiEnvelope<SansekaiComicRaw[]>>("/komik/latest?type=mirror"),
    ]).then(([a, b]) => {
      const seen = new Set<string>();
      const merged: Comic[] = [];
      for (const raw of [...(a.data || []), ...(b.data || [])]) {
        const comic = toComic(raw);
        if (comic.id && !seen.has(comic.id)) {
          seen.add(comic.id);
          merged.push(comic);
        }
      }
      return merged;
    });
    latestPoolPromise.catch(() => {
      latestPoolPromise = null;
    });
  }
  return latestPoolPromise;
}
export async function fetchLatestPool(max: number): Promise<Comic[]> {
  const pool = await fetchLatestRawPool();
  return pool.slice(0, max);
}

export async function quickSearch(title: string, limit = 8): Promise<Comic[]> {
  if (!title.trim()) return [];
  const json = await getJson<SansekaiEnvelope<SansekaiComicRaw[]>>(
    `/komik/search?query=${encodeURIComponent(title)}`,
  );
  return (json.data || []).slice(0, limit).map(toComic);
}

export interface Genre {
  title: string;
  slug: string;
}

// Sansekai has no /genre-all-style endpoint to pull a full genre list from
// (unlike Komiku), and scanning enough of the 1000-title popular pool to
// discover every genre tag would burn most of the 5-requests/minute budget
// on page load alone. This is the set of genres actually observed across
// several hundred sampled titles (via /komik/popular, /komik/latest and
// /komik/recommended) — "mature" (explicit-content marker) and "latest"
// (not a real genre, an artifact of the source data) are left out on
// purpose, same spirit as the old EXCLUDED_GENRE_SLUGS. Genre filtering
// itself isn't limited to this list — clicking any of these still filters
// the live popular pool by matching slug — this is just what's offered as
// clickable chips.
const CURATED_GENRES: Genre[] = [
  { slug: "action", title: "Action" },
  { slug: "adventure", title: "Adventure" },
  { slug: "comedy", title: "Comedy" },
  { slug: "demon", title: "Demon" },
  { slug: "drama", title: "Drama" },
  { slug: "fantasy", title: "Fantasy" },
  { slug: "fight", title: "Fight" },
  { slug: "game", title: "Game" },
  { slug: "historical", title: "Historical" },
  { slug: "horror", title: "Horror" },
  { slug: "isekai", title: "Isekai" },
  { slug: "magic", title: "Magic" },
  { slug: "martial-arts", title: "Martial Arts" },
  { slug: "murim", title: "Murim" },
  { slug: "mystery", title: "Mystery" },
  { slug: "psychological", title: "Psychological" },
  { slug: "revenge", title: "Revenge" },
  { slug: "romance", title: "Romance" },
  { slug: "school-life", title: "School Life" },
  { slug: "sci-fi", title: "Sci-fi" },
  { slug: "seinen", title: "Seinen" },
  { slug: "shounen", title: "Shounen" },
  { slug: "slice-of-life", title: "Slice of Life" },
  { slug: "sports", title: "Sports" },
  { slug: "supernatural", title: "Supernatural" },
].sort((a, b) => a.title.localeCompare(b.title));

export async function fetchGenres(): Promise<Genre[]> {
  return CURATED_GENRES;
}
