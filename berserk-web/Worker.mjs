import { Engine } from "../wasm/worker/berserk.js";

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store",
      ...extra,
    },
  });

function parseBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  return value;
}

function parseFen(fen) {
  if (fen === undefined || fen === null || fen === "") return null;
  if (typeof fen !== "string" || fen.length > 200) {
    throw new Error("fen must be a valid FEN string no longer than 200 characters.");
  }
  return fen;
}

function intInRange(value, name, min, max, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      }});
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, engine: "Berserk", engineSource: "official-knightly/Berserk", runtime: "wasm" });
    }

    if (request.method === "GET" && url.pathname === "/v1") {
      return json({
        name: "Berserk Engine API",
        version: "1",
        engine: "Berserk",
        endpoints: {
          "POST /v1/bestmove": { body: { fen: "optional FEN", movetimeMs: "optional integer 1-1000", depth: "optional integer 1-16" } },
          "POST /v1/analyse": { body: { fen: "optional FEN", depth: "optional integer 1-16", multiPv: "optional integer 1-5" } },
        },
        note: "This service runs the real Berserk Rust engine compiled to WebAssembly.",
      });
    }

    if (request.method !== "POST" || !["/v1/bestmove", "/v1/analyse"].includes(url.pathname)) {
      return json({ error: "Not found. See GET /v1 for API documentation." }, 404);
    }

    let body;
    try {
      body = parseBody(await request.json());
      const fen = parseFen(body.fen);
      const engine = new Engine();
      if (fen) engine.set_position(fen);

      let bestmove;
      if (url.pathname === "/v1/bestmove") {
        const depth = intInRange(body.depth, "depth", 1, 16, 0);
        const movetimeMs = intInRange(body.movetimeMs, "movetimeMs", 1, 1000, depth ? 0 : 250);
        if (depth) engine.go_uci(depth, 0, 1, undefined);
        else engine.go_movetime(movetimeMs, 1, undefined);
        bestmove = engine.last_bestmove();
      } else {
        const depth = intInRange(body.depth, "depth", 1, 16, 12);
        const multiPv = intInRange(body.multiPv, "multiPv", 1, 5, 1);
        engine.go_uci(depth, 0, multiPv, undefined);
        bestmove = engine.last_bestmove();
      }

      const rawOutput = engine.take_output();
      const result = {
        engine: "Berserk",
        bestmove,
        fen: engine.fen(),
        scoreCp: engine.last_score(),
        depth: engine.last_depth(),
        nodes: engine.last_nodes().toString(),
      };
      if (url.pathname === "/v1/analyse") {
        result.lines = rawOutput.split("\n").filter((line) => line.startsWith("info "));
      }
      if (!bestmove || bestmove === "(none)") {
        return json({ error: "Berserk did not return a legal best move for this position.", ...result }, 422);
      }
      return json(result);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Invalid request." }, 400);
    }
  },
};
