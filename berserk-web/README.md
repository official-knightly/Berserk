# Berserk Web API

A small Express API that runs the native Berserk UCI engine as a persistent subprocess. The Rust engine source and `Cargo.toml` are not changed. No WASM is used by this API.

## Endpoints

- `GET /health` — service status and whether the engine process is running.
- `POST /bestmove` — JSON `{ "fen": "...", "movetime": 1000 }`; returns `{ "bestmove": "e2e4", "info": "..." }`.
- Search requests are serialized, time is capped at 5000 ms, and rate limiting is 30 requests per minute per client IP.

## Local setup

Build the engine from the repository root first:

```sh
cargo build --release
```

On Windows the binary is normally `target/release/berserk.exe`; on Linux/macOS it is `target/release/berserk`.

Then install and run the API:

```sh
cd berserk-web
npm install
npm run build
npm start
```

By default the API listens on port 3000 and looks for `../target/release/berserk` relative to this folder. Set `ENGINE_PATH` to an absolute path if needed. Set `PORT` to change the port.

PowerShell example when the engine is at the default Windows location:

```powershell
$env:ENGINE_PATH = (Resolve-Path ..\target\release\berserk.exe).Path
$env:PORT = "3000"
npm run dev
```

## Test

```sh
curl -X POST http://localhost:3000/bestmove \
  -H "Content-Type: application/json" \
  -d '{"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","movetime":1000}'
```

Expected response shape:

```json
{"bestmove":"e2e4","info":"info depth ..."}
```

The exact move and info depend on the engine build and search.

## PM2 (Linux/macOS server)

```sh
cd berserk-web
npm install
npm run build
npx pm2 start ecosystem.config.cjs
npx pm2 save
npx pm2 startup
```

Run the command printed by `pm2 startup` with the required privileges, then run `npx pm2 save` again. Useful commands: `npx pm2 status`, `npx pm2 logs berserk-api`, `npx pm2 restart berserk-api`.

If using a custom engine path, set `ENGINE_PATH` in the PM2 environment before starting, or edit the `env` object in `ecosystem.config.cjs`.

## Docker / Railway / Render

Build from the repository root so Docker can see both `Cargo.toml` and `berserk-web/`:

```sh
docker build -f berserk-web/Dockerfile -t berserk-api .
docker run --rm -p 3000:3000 berserk-api
```

For Railway or Render, select Dockerfile deployment and set the Dockerfile path to `berserk-web/Dockerfile`, with the **repository root as build context**. The platform supplies `PORT`; the container listens on it. Replace the example URL in the client examples and OpenAPI schema with your real HTTPS deployment URL.

The Dockerfile uses a Rust build stage and a Node runtime stage. It installs native build prerequisites for the existing engine. If your current Rust toolchain cannot compile the repository's declared edition or native build dependencies, the image build will stop rather than changing your engine files.

## Website examples

See `examples/plain-javascript.html` and `examples/typescript.ts`. Replace `https://YOUR-API-DOMAIN.example.com` with your deployed API base URL.

An HTTPS website must call an HTTPS API. Browsers block HTTPS pages from making insecure HTTP fetches (mixed content). CORS must also allow the website origin; this API currently enables cross-origin requests.

## MCP server

`mcp/server.ts` exposes one MCP tool: `get_best_move(fen, movetime)`. It calls this HTTP API. Run it with:

```sh
cd berserk-web/mcp
npm install
npm run build
BERSERK_API_URL=https://YOUR-API-DOMAIN.example.com npm start
```

On PowerShell, set the variable with `$env:BERSERK_API_URL = "https://YOUR-API-DOMAIN.example.com"` before `npm start`. OpenAPI for a ChatGPT Action is in `openapi.yaml`; replace the example server URL before importing it.

## Common errors

- **Wrong ENGINE_PATH:** use an absolute path to the executable; Linux paths are case-sensitive.
- **Binary not built:** run `cargo build --release` from the repository root first.
- **CORS:** verify the browser's origin and API CORS configuration.
- **Mixed HTTP/HTTPS:** deploy the API with HTTPS when the calling website uses HTTPS.
- **Docker build fails:** inspect the Rust edition/toolchain and native dependencies in the existing engine project; this API setup does not alter the engine's Rust source or Cargo.toml.
