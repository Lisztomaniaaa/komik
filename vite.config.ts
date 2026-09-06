import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";

// api.mangadex.org does not send Access-Control-Allow-Origin, so a browser
// fetch straight from the frontend is blocked by CORS. /mdx is proxied
// server-side instead. This covers `vite dev` and `vite preview`; the
// equivalent for a Vercel deployment is the rewrite in vercel.json.
const mangadexProxy = {
  "/mdx": {
    target: "https://api.mangadex.org",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/mdx/, ""),
  },
};

const IMG_USER_AGENT = "PanpanComics/1.0 (+https://github.com/Lisztomaniaaa/komik)";

// MangaDex's image CDN occasionally answers a burst of concurrent requests
// (e.g. a whole grid of covers loading at once) with a stray 403 that
// succeeds a moment later — a couple of retries clears most of these up.
async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let last: Response | undefined;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 250 * i));
    try {
      last = await fetch(url, { headers: { "User-Agent": IMG_USER_AGENT } });
      if (last.ok) return last;
    } catch (e) {
      lastError = e;
    }
  }
  if (last) return last;
  throw lastError;
}

// Dev/preview equivalent of api/img.ts (the Vercel edge function): proxies
// MangaDex cover and chapter-page images server-side, for the same reason
// /mdx exists — some networks block the image CDN hosts directly even
// though they can reach our own origin fine.
async function handleImgProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const target = new URL(req.url ?? "", "http://localhost").searchParams.get("u");
  if (!target) {
    res.writeHead(400).end("Missing u param");
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    res.writeHead(400).end("Invalid url");
    return;
  }
  const allowed = parsed.hostname === "uploads.mangadex.org" || parsed.hostname.endsWith(".mangadex.network");
  if (!allowed) {
    res.writeHead(403).end("Host not allowed");
    return;
  }
  try {
    const upstream = await fetchWithRetry(parsed.toString());
    if (!upstream.ok || !upstream.body) {
      res.writeHead(upstream.status || 502).end("Upstream error");
      return;
    }
    res.writeHead(200, {
      "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch {
    res.writeHead(502).end("Proxy error");
  }
}

function imgProxyPlugin(): Plugin {
  return {
    name: "mangadex-img-proxy",
    configureServer(server) {
      server.middlewares.use("/api/img", handleImgProxy);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/img", handleImgProxy);
    },
  };
}

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
  plugins: [imgProxyPlugin()],
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
