import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
  // Stamped into the footer at runtime so a deployed build's freshness can
  // be checked at a glance instead of guessing whether the browser served a
  // cached index.html.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
