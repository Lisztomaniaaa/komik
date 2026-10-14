import "./style.css";
import "./app";
import "./uiChrome";

// Repeat-visit caching (see public/sw.js and README > "Sumber data").
// Production only — a service worker over the dev server would keep
// serving stale modules while iterating.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Caching is an optimization; the app works without it.
    });
  });
}
