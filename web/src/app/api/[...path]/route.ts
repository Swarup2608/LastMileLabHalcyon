import type { NextRequest } from "next/server";

// Forwards same-origin /api/* to the Halcyon API (api/). The browser only ever talks to this origin, so the API's
// httpOnly auth cookies are first-party here and no CORS or SameSite=None setup is needed. API_URL is read on every
// request (not baked in at build like a next.config rewrite), so it can be set as an App Service environment variable.

export const dynamic = "force-dynamic";

// Hop-by-hop or recomputed by the runtime; fetch also decompresses, so the upstream encoding/length no longer apply.
const DROP_REQUEST = ["host", "connection", "content-length"];
const DROP_RESPONSE = ["connection", "transfer-encoding", "content-encoding", "content-length"];

const apiUrl = () => (process.env.API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

async function forward(req: NextRequest) {
  const headers = new Headers(req.headers);
  for (const name of DROP_REQUEST) headers.delete(name);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl()}${req.nextUrl.pathname}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (err) {
    console.error("api proxy: upstream unreachable", err);
    return Response.json({ error: "API unavailable" }, { status: 502 });
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of DROP_RESPONSE) responseHeaders.delete(name);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE, forward as OPTIONS };
