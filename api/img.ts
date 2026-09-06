// Proxies MangaDex cover and chapter-page images through our own domain.
//
// Both the JSON API (see vercel.json's /mdx rewrite) and these images are
// fetched directly by the browser by default; on some networks (e.g. ISP-level
// blocks on manga/piracy-adjacent CDNs) the image hosts specifically are
// unreachable from the client even though our own domain is fine. Fetching
// server-side here sidesteps that the same way the /mdx rewrite does for API
// calls — and unlike the API, chapter-page hosts (*.mangadex.network) are
// assigned per-request, so a static rewrite can't cover them; this needs an
// actual function.

const USER_AGENT = "PanpanComics/1.0 (+https://github.com/Lisztomaniaaa/komik)";

// MangaDex's image CDN occasionally answers a burst of concurrent requests
// (e.g. a whole grid of covers loading at once) with a stray 403 that
// succeeds a moment later — a couple of retries clears most of these up.
async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let last: Response | undefined;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 250 * i));
    try {
      last = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (last.ok) return last;
    } catch (e) {
      lastError = e;
    }
  }
  if (last) return last;
  throw lastError;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = url.searchParams.get("u");
  if (!target) return new Response("Missing u param", { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  const allowed = parsed.hostname === "uploads.mangadex.org" || parsed.hostname.endsWith(".mangadex.network");
  if (!allowed) return new Response("Host not allowed", { status: 403 });

  let upstream: Response;
  try {
    upstream = await fetchWithRetry(parsed.toString());
  } catch {
    return new Response("Proxy error", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream error", { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}

export const config = { runtime: "edge" };
