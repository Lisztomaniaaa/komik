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
  | "history"
  | "notifications"
  | "settings"
  | "security";

export type SortMode = "latest" | "rating" | "az";

export type ReaderMode = "single" | "continuous";
export type ReaderBackground = "white" | "dark" | "black";

export interface ReadingProgressEntry {
  percent: number;
  updated: number;
}
