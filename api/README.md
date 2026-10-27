# Berserk Engine API

A small HTTP API that runs the **native Berserk engine** using its UCI interface. The engine source and search logic are not modified. This API lives beside the engine in the same repository.

## Endpoints

- `GET /health` — service health
- `POST /v1/bestmove` — return the engine's best move
- `POST /v1/analyse` — return best move and available search statistics

Request JSON:

```json
{
  "fen": "startpos",
  "moves": ["e2e4", "e7e5"],
  "movetime": 1000
}
```

Use `fen` as `"startpos"` or a complete FEN. `moves` is an optional list of UCI moves from that position. `movetime` is milliseconds; default 1000, capped by `MAX_MOVETIME` (default 5000). You may supply `depth` instead of movetime for a fixed-depth search.

## Run locally

Build Berserk from the repository root, then:

```sh
ENGINE_PATH=../target/release/berserk npm start
```

Run the commands from the `api` directory. The binary must be executable and support UCI.

## Docker

Build from the repository root so the Docker build can access the engine source:

```sh
docker build -f api/Dockerfile -t berserk-engine-api .
docker run --rm -p 8787:8787 berserk-engine-api
```

## Example

```sh
curl -X POST http://localhost:8787/v1/bestmove \
  -H 'Content-Type: application/json' \
  -d '{"fen":"startpos","moves":["e2e4","e7e5"],"movetime":1000}'
```

A board UI can call this endpoint after every human move and then play the returned `bestmove` on the board. For engine-vs-engine self-play, call it for each side in turn, applying each returned move to the game state and stopping at checkmate, stalemate, or another terminal result.

## Production notes

- Put this service behind HTTPS.
- Restrict CORS with `ALLOWED_ORIGINS=https://your-site.example`.
- Add authentication/API keys and per-client rate limits before making it public.
- A public API requires a host that can run the native executable; Cloudflare Workers alone cannot run this native process.
