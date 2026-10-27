export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";
    const corsOrigin = allowedOrigin === "*" || origin === allowedOrigin ? allowedOrigin : "null";
    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    let path;
    if (url.pathname === "/health" && request.method === "GET") {
      path = "/health";
    } else if (url.pathname === "/bestmove" && request.method === "POST") {
      path = "/bestmove";
    } else {
      return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
    }

    if (!env.BERSERK_API_URL) {
      return Response.json(
        { error: "Worker is missing the BERSERK_API_URL environment variable." },
        { status: 503, headers: corsHeaders }
      );
    }

    try {
      const upstreamUrl = new URL(path, env.BERSERK_API_URL);
      const headers = new Headers({ "Accept": "application/json" });
      const contentType = request.headers.get("Content-Type");
      if (contentType) headers.set("Content-Type", contentType);

      const init = {
        method: request.method,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(15000)
      };
      if (request.method === "POST") {
        init.body = await request.text();
      }

      const upstream = await fetch(upstreamUrl, init);
      const responseHeaders = new Headers(upstream.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        responseHeaders.set(key, value);
      }
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
      });
    } catch (error) {
      return Response.json(
        { error: "Berserk engine host is unreachable or timed out." },
        { status: 502, headers: corsHeaders }
      );
    }
  }
};
