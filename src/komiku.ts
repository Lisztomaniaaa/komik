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

function pageFromOffset(offset: number, limit: number): number {
  return Math.floor(offset / Math.max(1, limit)) + 1;
}

// Komiku's site doesn't expose sort-by-rating (nothing to sort by — see
// NO_RATING) or a status filter at list level, and pages come back at a
// fixed ~10-per-page size rather than an exact total count. `total` below
// is therefore a "just enough for the pager" estimate: current items plus
// one more page's worth whenever the source signals more are available.
function applyClientFilters(comics: Comic[], q: ListQuery): Comic[] {
  let out = comics;
  if (q.type && q.type !== "All") out = out.filter((c) => c.type === q.type);
  if (q.sort === "az") out = [...out].sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

export async function fetchList(q: ListQuery): Promise<{ comics: Comic[]; total: number }> {
  const page = pageFromOffset(q.offset, q.limit);

  if (q.title) {
    const json = await getJson<{ data: KomikuCard[] }>(`/search?q=${encodeURIComponent(q.title)}`);
    const comics = applyClientFilters(json.data.map(toComicFromCard), q);
    return { comics: comics.slice(0, q.limit), total: q.offset + comics.length };
  }

  if (q.genre && q.genre !== "All") {
    const slug = q.genre.toLowerCase().replace(/\s+/g, "-");
    const json = await getJson<{ data: KomikuCard[]; hasNextPage: boolean }>(`/genre/${slug}/page/${page}`);
    const comics = applyClientFilters(json.data.map(toComicFromCard), q);
    const total = q.offset + comics.length + (json.hasNextPage ? q.limit : 0);
    return { comics, total };
  }

  const json = await getJson<{ results: KomikuCard[] }>(`/pustaka/page/${page}`);
  const comics = applyClientFilters(json.results.map(toComicFromCard), q);
  const total = q.offset + comics.length + (json.results.length >= 10 ? q.limit : 0);
  return { comics, total };
}

export async function fetchPopular(limit = 5): Promise<Comic[]> {
  const json = await getJson<KomikuCard[]>("/rekomendasi");
  return json.slice(0, limit).map(toComicFromCard);
}

export async function fetchLatestUpdates(limit = 3): Promise<Comic[]> {
  const json = await getJson<KomikuCard[]>("/terbaru");
  return json.slice(0, limit).map(toComicFromCard);
}

export async function quickSearch(title: string, limit = 8): Promise<Comic[]> {
  if (!title.trim()) return [];
  const json = await getJson<{ data: KomikuCard[] }>(`/search?q=${encodeURIComponent(title)}`);
  return json.data.slice(0, limit).map(toComicFromCard);
}
