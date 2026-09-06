// Whether the 6 required Firebase env vars are present — checked before
// touching any Firebase SDK code so app.ts can import this statically
// (cheap) without forcing that SDK to load for visitors who never log in
// or open a comment thread.
export const firebaseConfigured = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET &&
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID &&
    import.meta.env.VITE_FIREBASE_APP_ID,
);
