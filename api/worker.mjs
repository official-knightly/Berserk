import { Engine } from "../wasm/worker/berserk.js";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};
function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors },
  });
}
function integer(value, key, min, max, fallback) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  return value;
}
function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Body must be a JSON object.");
  if (body.fen != null && (typeof body.fen !== "string" || body.fen.length > 200 || body.fen.trim().split(/\s+/).length !== 6)) {
    throw new Error("fen must be a six-field FEN string.");
  }
  return body;
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET" && url.pathname === "/health") {
      return respond({ ok: true, engine: "Berserk", runtime: "WebAssembly", source: "official-knightly/Berserk" });
    }
    if (request.method === "GET" && url.pathname === "/v1") {
      return respond({
        name: "Berserk Engine API",
        endpoints: {
          "POST /v1/bestmove": { body: { fen: "optional FEN", depth: "integer 1-16 OR movetimeMs 1-1000" } },
          "POST /v1/analyse": { body: { fen: "optional FEN", depth: "integer 1-16", multiPv: "integer 1-5" } },
        },
      });
    }
    if (request.method !== "POST" || !["/v1/bestmove", "/v1/analyse"].includes(url.pathname)) {
      return respond({ error: "Not found. See GET /v1." }, 404);
    }
    try {
      const body = validateBody(await request.json());
      const engine = new Engine();
      if (body.fen) engine.set_position(body.fen);
      const isAnalysis = url.pathname === "/v1/analyse";
      const multiPv = integer(body.multiPv, "multiPv", 1, 5, 1);
      const depth = integer(body.depth, "depth", 1, 16, isAnalysis ? 12 : 0);
      if (isAnalysis || depth > 0) engine.go_uci(depth || 0, 0, multiPv, undefined);
      else engine.go_movetime(integer(body.movetimeMs, "movetimeMs", 1, 1000, 250), multiPv, undefined);
      const bestmove = engine.last_bestmove();
      const raw = engine.take_output();
      const result = {
        engine: "Berserk",
        bestmove,
        fen: engine.fen(),
        scoreCp: engine.last_score(),
        depth: engine.last_depth(),
        nodes: engine.last_nodes().toString(),
      };
      if (isAnalysis) result.lines = raw.split("\n").filter(line => line.startsWith("info "));
      if (!bestmove || bestmove === "(none)") return respond({ error: "No legal move is available.", ...result }, 422);
      return respond(result);
    } catch (error) {
      return respond({ error: error instanceof Error ? error.message : "Invalid request." }, 400);
    }
  },
};
