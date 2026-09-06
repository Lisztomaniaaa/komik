import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { commentsConfigured } from "./commentsConfig";

// These 6 values come from the Firebase Console's "Add app" (Web) config
// snippet. They're meant to be public — client apps ship them in the
// bundle by design; Firestore Security Rules (firestore.rules) are what
// actually decide who can read/write what, not secrecy of this config.
//
// This file (and everything it pulls in — the Firebase SDK is ~500KB) is
// only ever reached via a dynamic import() from comments.ts's callers, so
// pages that never touch comments don't pay for it.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

export const db = commentsConfigured ? getFirestore(initializeApp(config)) : null;
