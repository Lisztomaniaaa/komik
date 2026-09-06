import { initializeApp, type FirebaseApp } from "firebase/app";
import { firebaseConfigured } from "./firebaseConfig";

// These 6 values come from the Firebase Console's "Add app" (Web) config
// snippet. They're meant to be public — client apps ship them in the
// bundle by design; Firestore Security Rules (firestore.rules) decide who
// can read/write what, not secrecy of this config.
//
// Only firebase/app lives here (small). Auth (src/auth.ts) is loaded
// eagerly from it since the login button in the topbar needs to know the
// session state on every page; Firestore (src/comments.ts, ~500KB) stays
// behind a dynamic import(), reached only once a comment thread is
// actually opened.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

export const app: FirebaseApp | null = firebaseConfigured ? initializeApp(config) : null;
