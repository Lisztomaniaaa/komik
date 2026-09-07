export type ComicType = "Manga" | "Manhwa" | "Manhua" | "Webtoon";
export type ComicStatus = "Ongoing" | "Completed" | "Hiatus" | "Cancelled";

export interface Comic {
  id: string;
  title: string;
  type: ComicType;
  genres: string[];
  status: ComicStatus;
  rating: number;
  chapters: number;
  readers: string;
  desc: string;
  cover: string | null;
}

export interface ChapterEntry {
  id: string;
  label: string;
  chapterNumber: number | null;
  publishAt: string;
  // The manga slug to use when fetching this chapter's pages. Usually equal
  // to the comic's own id, but Komiku sometimes serves a title's chapters
  // under a different slug than its detail page (e.g. detail page
  // "komik-one-piece-indo" but chapters read under "one-piece").
  readerSlug: string;
}

export type FilterKey = "type" | "genre" | "status";

export interface Filters {
  type: ComicType | "All";
  genre: string | "All";
  status: ComicStatus | "All";
}

export type AccountTab =
  | "overview"
  | "profile"
  | "library"
  | "notifications"
  | "settings"
  | "security";

export type SortMode = "latest" | "rating" | "az";

export interface ReadingProgressEntry {
  percent: number;
  updated: number;
}

export interface CommentRow {
  id: string;
  manga_id: string;
  chapter_id: string | null;
  name: string;
  body: string;
  created_at: string;
}
