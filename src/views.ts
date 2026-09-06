import { collection, doc, getDocs, getFirestore, increment, limit, orderBy, query, setDoc } from "firebase/firestore";
import { app } from "./firebase";

// Lazy-loaded the same way comments.ts is (dynamic import from app.ts) —
// only pages that actually render the "Trending today" strip or open a
// comic pay for pulling in firebase/firestore.
const db = app ? getFirestore(app) : null;

// Komiku has no view/read-count data of its own (see src/komiku.ts), so
// "trending today" is tracked ourselves: one counter document per manga per
// day, reset automatically just by the date changing. `views/<date>/mangas`
// is a plain collection (no equality filter needed to scope it to a day),
// so ordering by count needs no composite index.
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export async function trackView(mangaId: string): Promise<void> {
  if (!db) return;
  try {
    await setDoc(doc(db, "views", todayKey(), "mangas", mangaId), { count: increment(1) }, { merge: true });
  } catch {
    // Best-effort — a failed view ping should never block reading.
  }
}

export async function fetchTopViewedToday(max: number): Promise<string[]> {
  if (!db) return [];
  try {
    const q = query(collection(db, "views", todayKey(), "mangas"), orderBy("count", "desc"), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.id);
  } catch {
    return [];
  }
}
