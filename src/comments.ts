import type { CommentRow } from "./types";

// Talks to Supabase's auto-generated REST API (PostgREST) directly with
// fetch, rather than pulling in @supabase/supabase-js, since this is the
// only thing the app needs from it. The anon key is meant to be public
// (it's shipped in the client bundle); Row Level Security policies on the
// `comments` table are what actually decide what it's allowed to do — see
// supabase/schema.sql.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const commentsConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function headers(): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

export async function fetchComments(
  mangaId: string,
  chapterId: string | null,
  offset: number,
  limit: number,
): Promise<CommentRow[]> {
  if (!commentsConfigured) return [];
  const chapterFilter = chapterId ? `chapter_id=eq.${chapterId}` : "chapter_id=is.null";
  const url = `${SUPABASE_URL}/rest/v1/comments?manga_id=eq.${mangaId}&${chapterFilter}&order=created_at.desc&limit=${limit}&offset=${offset}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Failed to load comments (${res.status})`);
  return (await res.json()) as CommentRow[];
}

export async function postComment(row: {
  manga_id: string;
  chapter_id: string | null;
  name: string;
  rating: number;
  body: string;
}): Promise<CommentRow> {
  if (!commentsConfigured) throw new Error("Comments are not configured.");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/comments`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Failed to post comment (${res.status})`);
  const data = (await res.json()) as CommentRow[];
  return data[0];
}
