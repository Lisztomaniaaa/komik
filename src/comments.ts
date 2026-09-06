import {
  addDoc,
  collection,
  getDocs,
  getFirestore,
  limit,
  query,
  where,
} from "firebase/firestore";
import { app } from "./firebase";
import type { CommentRow } from "./types";

// getFirestore (and the ~500KB firebase/firestore module behind it) only
// runs once this module is actually reached — app.ts dynamically import()s
// this file rather than importing it at the top level, so pages that never
// open a comment thread don't pay for it.
const db = app ? getFirestore(app) : null;

// A Firestore query that combines an equality filter with `orderBy` on a
// different field needs a manually-created composite index (confirmed
// against Firebase's docs) — not something to ask a non-coder to set up in
// the console. Sorting client-side instead means the query is a single
// equality filter, which is always covered by Firestore's automatic
// indexes. `limit(200)` keeps this from ever pulling an unbounded thread;
// comment volume on a hobby project's reader is nowhere near that.
const THREAD_FETCH_LIMIT = 200;

function threadId(mangaId: string, chapterId: string | null): string {
  return `${mangaId}::${chapterId ?? "detail"}`;
}

export async function fetchThread(mangaId: string, chapterId: string | null): Promise<CommentRow[]> {
  if (!db) return [];
  const q = query(
    collection(db, "comments"),
    where("thread_id", "==", threadId(mangaId, chapterId)),
    limit(THREAD_FETCH_LIMIT),
  );
  const snap = await getDocs(q);
  const rows = snap.docs.map((d): CommentRow => {
    const data = d.data() as {
      manga_id: string;
      chapter_id: string | null;
      name: string;
      rating: number;
      body: string;
      created_at?: { toDate: () => Date };
    };
    const createdAt = data.created_at?.toDate ? data.created_at.toDate() : new Date();
    return {
      id: d.id,
      manga_id: data.manga_id,
      chapter_id: data.chapter_id,
      name: data.name,
      rating: data.rating,
      body: data.body,
      created_at: createdAt.toISOString(),
    };
  });
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return rows;
}

export async function postComment(row: {
  manga_id: string;
  chapter_id: string | null;
  uid: string;
  name: string;
  rating: number;
  body: string;
}): Promise<CommentRow> {
  if (!db) throw new Error("Comments are not configured.");
  const now = new Date();
  const docRef = await addDoc(collection(db, "comments"), {
    thread_id: threadId(row.manga_id, row.chapter_id),
    manga_id: row.manga_id,
    chapter_id: row.chapter_id,
    uid: row.uid,
    name: row.name,
    rating: row.rating,
    body: row.body,
    created_at: now,
  });
  return {
    id: docRef.id,
    manga_id: row.manga_id,
    chapter_id: row.chapter_id,
    name: row.name,
    rating: row.rating,
    body: row.body,
    created_at: now.toISOString(),
  };
}
