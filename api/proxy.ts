// Vercel Edge proxy + cache for the Sanka provider instances.
//
// Why this exists (measured 2026-10-14): the comic JSON payloads are
// tiny (12–22 KB), so the app's load time is entirely origin TTFB and
// round trips. The public Sanka instances answer in ~0.35 s
// (KomikIndo) to ~1–1.7 s (KomikCast, a Cloudflare tunnel to a home
// server, with occasional multi-second spikes) — per request, and a
// cold home screen needs several. This proxy puts Vercel's edge cache
// in front of them: responses are cached per the TTL table below and
// served stale-while-revalidate, so repeat loads of warm paths are
// edge hits (~tens of ms from the user's nearest PoP), and a warm
// cache keeps serving while an origin is having a bad minute.
//
// The client (src/comicApi.ts) only uses this proxy in production
// builds and falls back to the direct origin — and then to the next
// provider — if it errors, so a broken proxy degrades to the pre-proxy
// behavior instead of breaking the app.
//
// Usage: GET /api/proxy?p=komikindo|komikcast&path=<url-encoded path>
// e.g. /api/proxy?p=komikindo&path=%2Flatest%2F1

export const config = { runtime: "edge" };

const UPSTREAMS: Record<string, string> = {
  komikindo: "https://www.sankavollerei.web.id/comic/komikindo",
  komikcast: "https://komikcast.aoxi.my.id/comic/komikcast",
};

// [s-maxage, stale-while-revalidate] in seconds, by path type. Chapter
// page lists and genre lists barely ever change; detail pages change
// when a chapter drops; latest/search/library are the freshness-
// sensitive surfaces, so they get short TTLs with long SWR windows —
// a slightly stale "latest" rail for a minute beats a 1.5 s wait.
function ttlFor(path: string): [number, number] {
  if (path.startsWith("/chapter/")) return [3600, 86400];
  if (path.startsWith("/genres")) return [3600, 86400];
  if (path.startsWith("/detail/")) return [600, 86400];
  if (path.startsWith("/library")) return [300, 3600];
  return [60, 600]; // /latest/*, /search/*
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  const url = new URL(req.url);
  const provider = url.searchParams.get("p") || "";
  const path = url.searchParams.get("path") || "";
  const base = UPSTREAMS[provider];
  if (!base || !path.startsWith("/") || path.includes("..")) {
    return Response.json(
      { error: "bad proxy request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${base}${path}`, {
      headers: { "User-Agent": "KomikVibe/1.0 (Vercel edge proxy)" },
    });
  } catch {
    return Response.json(
      { error: "upstream unreachable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
  if (upstream.ok) {
    const [ttl, swr] = ttlFor(path);
    headers.set("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${swr}`);
  } else {
    // Never cache errors — a cached 403/500 would outlive the outage.
    headers.set("Cache-Control", "no-store");
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
