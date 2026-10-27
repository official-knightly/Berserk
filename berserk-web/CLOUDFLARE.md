# Cloudflare Worker proxy for Berserk API

This Worker exposes the public HTTPS API while forwarding engine requests to the existing Berserk Node.js API. It does not compile or modify the chess engine.

## 1. Create the Worker

1. Open https://dash.cloudflare.com/
2. Go to **Workers & Pages** and create a Worker.
3. Open the Worker editor and replace the starter code with the contents of `cloudflare-worker.js`.
4. Deploy the Worker.

## 2. Configure the upstream API URL

In the Worker settings, add a text variable:

- Name: `BERSERK_API_URL`
- Value: the base URL of the running Berserk API, for example `https://your-engine-api.example.com`

Use only the base URL; do not append `/health` or `/bestmove`.

Optional CORS restriction:

- Name: `ALLOWED_ORIGIN`
- Value: the exact origin of your website, such as `https://your-site.pages.dev`

If `ALLOWED_ORIGIN` is omitted, the Worker allows browser requests from any origin. The API should still be protected with rate limits at the engine host.

## 3. Test the Worker

Open `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/health`. A healthy response should contain the upstream API's JSON health result.

For a move request, send a POST to `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/bestmove` with JSON:

```json
{
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "movetime": 1000
}
```

The response should include `bestmove` and `info`.

## Engine hosting recommendation

For a free VM with enough RAM to build and run the existing native engine, Oracle Cloud Always Free Ampere A1 is the first option to investigate. The documented allowance is up to 2 OCPUs and 12 GB RAM in the account's home region. Availability varies, and Oracle can reclaim instances that meet its idle-instance criteria over a 7-day period. Therefore, it is not a guarantee of uninterrupted forever hosting. Review https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm before creating resources.

The API Docker build needs the repository root as its Docker build context, because the Dockerfile copies the engine source from the root. Use:

- Dockerfile path: `berserk-web/Dockerfile`
- Docker build context: `.`

Do not change the engine source, search/evaluation logic, or repository `Cargo.toml` to deploy this Worker.
