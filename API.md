# Berserk Engine API

The public API runs the real Berserk Rust engine compiled to WebAssembly in this repository.

- `GET /health` — service identity
- `GET /v1` — API help
- `POST /v1/bestmove` — best move and search metadata
- `POST /v1/analyse` — fixed-depth search and UCI-style info lines

## Best move request

```json
{ "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "movetimeMs": 250 }
```

Use either `movetimeMs` (1–1000) or `depth` (1–16).

## Analysis request

```json
{ "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "depth": 12, "multiPv": 3 }
```

`multiPv` accepts 1–5.

## Website integration

```js
const response = await fetch("https://YOUR-WORKER.workers.dev/v1/bestmove", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ fen, movetimeMs: 250 })
});
if (!response.ok) throw new Error(await response.text());
const result = await response.json();
console.log(result.bestmove, result.scoreCp, result.depth);
```

Automatic deployment requires repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The Worker configuration requests a 30-second CPU budget, which requires a Cloudflare plan that supports it. Do not advertise the API as live until a deployed `POST /v1/bestmove` returns a legal move.
