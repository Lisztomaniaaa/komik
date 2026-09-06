import type { ChapterEntry, Comic, ComicStatus, ComicType } from "./types";

const API_BASE = "/mdx";
const COVER_BASE = "https://uploads.mangadex.org/covers";

// Routes an image URL through our own origin (api/img.ts in production, the
// Vite dev-server middleware locally) instead of letting the browser fetch it
// from MangaDex directly. Some networks block the image CDN hosts even when
// api.mangadex.org (proxied separately via /mdx) is reachable.
function proxiedImage(url: string): string {
  return `/api/img?u=${encodeURIComponent(url)}`;
}

// The 7 genres this app's UI offers as filters, mapped to MangaDex's tag UUIDs
// (from GET /manga/tag, group "genre"). MangaDex has many more tags; this app
// only exposes the subset the original mockup's markup already has buttons for.
export const GENRE_TAG_IDS: Record<string, string> = {
  Action: "391b0423-d847-456f-aff0-8b0cfc03066b",
  Adventure: "87cc87cd-a395-47af-b27a-93258283bbc6",
  Romance: "423e2eae-a7a2-4a8b-ac03-a8351462d71d",
  Fantasy: "cdc58593-87dd-415e-bbc0-2ec27bf404cc",
  Comedy: "4d32cc48-9f00-4cca-9b5a-a839f0764984",
  Drama: "b9af3a63-f058-46de-a9a0-e0c13906197a",
  Horror: "cdad7e68-1419-41dd-bdce-27753074a640",
};

// MangaDex has no "webtoon" field; "Long Strip" (format tag) is the closest
// signal, so it takes priority over the originalLanguage-based Manga/
// Manhwa/Manhua guess below.
const LONG_STRIP_TAG_ID = "3e2b8dae-350e-4ab8-a8ce-016e844b9f0d";

interface MangaDexTagRef {
  id: string;
  attributes: { group: string; name: Record<string, string> };
}
interface MangaDexRelationship {
  type: string;
  attributes?: { fileName?: string };
}
interface MangaDexMangaAttributes {
  title: Record<string, string>;
  altTitles: Record<string, string>[];
  description: Record<string, string>;
  status: string;
  originalLanguage: string;
  lastChapter: string | null;
  tags: MangaDexTagRef[];
}
interface MangaDexManga {
  id: string;
  attributes: MangaDexMangaAttributes;
  relationships: MangaDexRelationship[];
}
interface MangaDexListResponse {
  result: string;
  data: MangaDexManga[];
  total: number;
}
interface MangaDexStatisticsResponse {
  statistics: Record<string, { rating: { average: number | null }; follows: number }>;
}
interface MangaDexChapter {
  id: string;
  attributes: { chapter: string | null; title: string | null; publishAt: string; pages: number };
}
interface MangaDexFeedResponse {
  data: MangaDexChapter[];
}
interface MangaDexAtHomeResponse {
  baseUrl: string;
  chapter: { hash: string; data: string[] };
}

function pickLocale(record: Record<string, string> | undefined): string {
  if (!record) return "";
  return record.id || record.en || Object.values(record)[0] || "";
}

function coverUrl(manga: MangaDexManga): string | null {
  const cover = manga.relationships.find((r) => r.type === "cover_art");
  const fileName = cover?.attributes?.fileName;
  return fileName ? proxiedImage(`${COVER_BASE}/${manga.id}/${fileName}.512.jpg`) : null;
}

function deriveType(manga: MangaDexManga): ComicType {
  const tagIds = manga.attributes.tags.map((t) => t.id);
  if (tagIds.includes(LONG_STRIP_TAG_ID)) return "Webtoon";
  switch (manga.attributes.originalLanguage) {
    case "ja":
      return "Manga";
    case "ko":
      return "Manhwa";
    case "zh":
    case "zh-hk":
      return "Manhua";
    default:
      return "Manga";
  }
}

function deriveGenres(manga: MangaDexManga): string[] {
  return manga.attributes.tags
    .filter((t) => t.attributes.group === "genre")
    .map((t) => pickLocale(t.attributes.name) || t.attributes.name.en)
    .filter((name): name is string => Boolean(name));
}

function deriveStatus(status: string): ComicStatus {
  switch (status) {
    case "completed":
      return "Completed";
    case "hiatus":
      return "Hiatus";
    case "cancelled":
      return "Cancelled";
    default:
      return "Ongoing";
  }
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function toComic(manga: MangaDexManga, stats?: { rating: number; follows: number }): Comic {
  const title = pickLocale(manga.attributes.title) || pickLocale(Object.assign({}, ...manga.attributes.altTitles));
  const lastChapter = Number.parseFloat(manga.attributes.lastChapter ?? "");
  return {
    id: manga.id,
    title: title || "(untitled)",
    type: deriveType(manga),
    genres: deriveGenres(manga),
    status: deriveStatus(manga.attributes.status),
    rating: stats ? Math.round((stats.rating / 2) * 10) / 10 : 0,
    chapters: Number.isFinite(lastChapter) ? lastChapter : 0,
    readers: stats ? formatCount(stats.follows) : "-",
    desc: pickLocale(manga.attributes.description) || "No description available.",
    cover: coverUrl(manga),
  };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`MangaDex request failed (${res.status}): ${path}`);
  return res.json() as Promise<T>;
}

export async function fetchStatisticsBatch(ids: string[]): Promise<Record<string, { rating: number; follows: number }>> {
  if (ids.length === 0) return {};
  const params = ids.map((id) => `manga[]=${id}`).join("&");
  const json = await getJson<MangaDexStatisticsResponse>(`/statistics/manga?${params}`);
  const out: Record<string, { rating: number; follows: number }> = {};
  for (const [id, s] of Object.entries(json.statistics)) {
    out[id] = { rating: s.rating.average ?? 0, follows: s.follows ?? 0 };
  }
  return out;
}

async function toComicsWithStats(mangas: MangaDexManga[]): Promise<Comic[]> {
  const stats = await fetchStatisticsBatch(mangas.map((m) => m.id));
  return mangas.map((m) => toComic(m, stats[m.id]));
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

function buildListParams(q: ListQuery): string {
  const params = new URLSearchParams();
  params.append("offset", String(q.offset));
  params.append("limit", String(q.limit));
  params.append("includes[]", "cover_art");
  params.append("contentRating[]", "safe");
  params.append("contentRating[]", "suggestive");
  params.append("availableTranslatedLanguage[]", "id");
  if (q.title) params.append("title", q.title);
  if (q.genre && q.genre !== "All" && GENRE_TAG_IDS[q.genre]) {
    params.append("includedTags[]", GENRE_TAG_IDS[q.genre]);
  }
  if (q.status && q.status !== "All") {
    params.append("status[]", q.status.toLowerCase());
  }
  if (q.type && q.type !== "All") {
    if (q.type === "Webtoon") params.append("includedTags[]", LONG_STRIP_TAG_ID);
    else if (q.type === "Manga") params.append("originalLanguage[]", "ja");
    else if (q.type === "Manhwa") params.append("originalLanguage[]", "ko");
    else if (q.type === "Manhua") {
      params.append("originalLanguage[]", "zh");
      params.append("originalLanguage[]", "zh-hk");
    }
  }
  switch (q.sort) {
    case "rating":
      params.append("order[rating]", "desc");
      break;
    case "az":
      params.append("order[title]", "asc");
      break;
    default:
      params.append("order[latestUploadedChapter]", "desc");
  }
  return params.toString();
}

export async function fetchList(q: ListQuery): Promise<{ comics: Comic[]; total: number }> {
  const json = await getJson<MangaDexListResponse>(`/manga?${buildListParams(q)}`);
  const comics = await toComicsWithStats(json.data);
  return { comics, total: json.total };
}

export async function fetchPopular(limit = 5): Promise<Comic[]> {
  const { comics } = await fetchList({ offset: 0, limit, sort: "rating" });
  return comics;
}

export async function fetchLatestUpdates(limit = 3): Promise<Comic[]> {
  const { comics } = await fetchList({ offset: 0, limit, sort: "latest" });
  return comics;
}

export async function quickSearch(title: string, limit = 8): Promise<Comic[]> {
  if (!title.trim()) return [];
  const { comics } = await fetchList({ offset: 0, limit, sort: "latest", title });
  return comics;
}

export async function fetchMangaDetail(id: string): Promise<Comic> {
  const json = await getJson<{ data: MangaDexManga }>(`/manga/${id}?includes[]=cover_art`);
  const stats = await fetchStatisticsBatch([id]);
  return toComic(json.data, stats[id]);
}

export async function fetchChapters(mangaId: string): Promise<ChapterEntry[]> {
  const fetchFor = async (lang: string) => {
    const params = new URLSearchParams();
    params.append("translatedLanguage[]", lang);
    params.append("order[chapter]", "desc");
    params.append("limit", "100");
    params.append("contentRating[]", "safe");
    params.append("contentRating[]", "suggestive");
    const json = await getJson<MangaDexFeedResponse>(`/manga/${mangaId}/feed?${params.toString()}`);
    return json.data;
  };

  let raw = await fetchFor("id");
  if (raw.length === 0) raw = await fetchFor("en");

  const seen = new Set<string>();
  const entries: ChapterEntry[] = [];
  for (const ch of raw) {
    const key = ch.attributes.chapter ?? ch.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const num = ch.attributes.chapter ? Number.parseFloat(ch.attributes.chapter) : null;
    entries.push({
      id: ch.id,
      label: num !== null && Number.isFinite(num) ? `Chapter ${num}` : ch.attributes.title || "Chapter",
      chapterNumber: num,
      publishAt: ch.attributes.publishAt,
    });
  }
  return entries;
}

export async function fetchChapterPages(chapterId: string): Promise<string[]> {
  const json = await getJson<MangaDexAtHomeResponse>(`/at-home/server/${chapterId}`);
  return json.chapter.data.map((fileName) =>
    proxiedImage(`${json.baseUrl}/data/${json.chapter.hash}/${fileName}`),
  );
}
