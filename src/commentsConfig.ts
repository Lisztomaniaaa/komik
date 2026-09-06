// Split out from firebase.ts/comments.ts so checking "are comments turned
// on" doesn't force-load the Firebase SDK — app.ts imports this statically,
// and dynamically imports ./comments (which pulls in Firebase) only once
// commentsConfigured is true and a comment thread is actually needed.
export const commentsConfigured = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET &&
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID &&
    import.meta.env.VITE_FIREBASE_APP_ID,
);
