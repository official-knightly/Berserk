# Berserk Engine HTTP API

The API is designed for chess websites and apps that want to request moves or analysis from the **real Berserk engine**. It is separate from the browser UI. It is served by the Cloudflare Worker configured in `wrangler.jsonc`.

## Endpoints

- `GET /health` — service and engine identity.
- `GET /v1` — endpoint description.
- `POST /v1/bestmove` — best move and search metadata.
- `POST /v1/analyse` — fixed-depth search with UCI-style info lines.

### Best move

```http
POST /v1/bestmove
Content-Type: application/json
```

```json
{
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "movetimeMs": 250
}
```

Alternatively send `"depth": 12` (1–16) instead of `movetimeMs` (1–1000).

Example response:

```json
{
  "engine": "Berserk",
  "bestmove": "e2e4",
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "scoreCp": 18,
  "depth": 8,
  "nodes": "12345"
}
```

Values in this example illustrate the response shape; actual moves, scores, depth, and node counts depend on the position and search.

### Analysis

```http
POST /v1/analyse
Content-Type: application/json
```

```json
{
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "depth": 12,
  "multiPv": 3
}
```

Returns the best move, score, completed depth, nodes, and captured `info` lines. `multiPv` accepts 1–5.

## Integration example

```js
const response = await fetch("https://YOUR-WORKER.workers.dev/v1/bestmove", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ fen, movetimeMs: 250 })
});
if (!response.ok) throw new Error(await response.text());
const { bestmove, scoreCp, depth } = await response.json();
```

## Hosting and limits

Deploy with `npx wrangler deploy` from the repository root after the generated `wasm/worker/` files exist. The Worker has a configured 30-second CPU budget; the Cloudflare account must support that limit. Do not expose this endpoint as production-ready until deployment succeeds and a live best-move request has been verified. Add application-level rate limiting or an API gateway before offering unrestricted high-volume public traffic.
