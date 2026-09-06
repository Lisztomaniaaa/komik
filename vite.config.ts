import { defineConfig } from "vite";

// api.mangadex.org does not send Access-Control-Allow-Origin, so a browser
// fetch straight from the frontend is blocked by CORS. /mdx is proxied
// server-side instead. This covers `vite dev` and `vite preview`; a real
// deployment needs an equivalent proxy/rewrite rule (see README).
const mangadexProxy = {
  "/mdx": {
    target: "https://api.mangadex.org",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/mdx/, ""),
  },
};

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
  server: {
    proxy: mangadexProxy,
  },
  preview: {
    proxy: mangadexProxy,
  },
  // Stamped into the footer at runtime so a deployed build's freshness can
  // be checked at a glance instead of guessing whether the browser served a
  // cached index.html.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
