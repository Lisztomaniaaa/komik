import { collection, doc, getDocs, getFirestore, setDoc } from "firebase/firestore";
import { app } from "./firebase";

// Sansekai does report its own aggregate user_rate per title (used for
// Comic.rating, shown on cards/search results), but the "reader rating"
// widget on a comic's page is a separate, first-party tap-to-rate feature —
// deliberately separate from the text comment system. One doc per user per
// manga (`ratings/{mangaId}/users/{uid}`) so a rule can enforce "only your
// own rating, 1-5 stars"; the average is just computed client-side over that
// subcollection, same low-index-overhead approach as src/views.ts.
const db = app ? getFirestore(app) : null;

export interface RatingSummary {
  average: number;
  count: number;
  userStars: number | null;
}

export async function fetchRatingSummary(mangaId: string, uid?: string | null): Promise<RatingSummary> {
  if (!db) return { average: 0, count: 0, userStars: null };
  try {
    const snap = await getDocs(collection(db, "ratings", mangaId, "users"));
    let sum = 0;
    let userStars: number | null = null;
    snap.forEach((d) => {
      const stars = d.data().stars as number;
      sum += stars;
      if (uid && d.id === uid) userStars = stars;
    });
    const count = snap.size;
    return { average: count ? sum / count : 0, count, userStars };
  } catch {
    return { average: 0, count: 0, userStars: null };
  }
}

export async function submitRating(mangaId: string, uid: string, stars: number): Promise<void> {
  if (!db) throw new Error("Ratings aren't set up yet.");
  await setDoc(doc(db, "ratings", mangaId, "users", uid), { stars, updated: Date.now() });
}
