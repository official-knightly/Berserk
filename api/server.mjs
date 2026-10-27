import http from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 8787);
const ENGINE_PATH = process.env.ENGINE_PATH || new URL("../target/release/berserk", import.meta.url).pathname;
const MAX_MOVETIME = Math.max(100, Math.min(10000, Number(process.env.MAX_MOVETIME || 5000)));
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());
let engine;
let input = "";
let waiters = [];
let queue = Promise.resolve();

function cors(req, res) {
  const origin = req.headers.origin || "";
  const allow = ALLOWED_ORIGINS.includes("*") ? "*" : (ALLOWED_ORIGINS.includes(origin) ? origin : "");
  if (allow) res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}
function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
function bootEngine() {
  if (engine && !engine.killed) return;
  engine = spawn(ENGINE_PATH, [], { stdio: ["pipe", "pipe", "pipe"] });
  input = "";
  engine.stdout.setEncoding("utf8");
  engine.stdout.on("data", chunk => {
    input += chunk;
    const lines = input.split(/\r?\n/);
    input = lines.pop() || "";
    for (const line of lines) {
      for (const w of [...waiters]) {
        if (w.match(line)) {
          waiters = waiters.filter(x => x !== w);
          clearTimeout(w.timer);
          w.resolve(line);
        }
        if (w.collect && line.startsWith("info ")) w.info.push(line);
      }
    }
  });
  engine.stderr.on("data", chunk => console.error("[berserk]", String(chunk).trim()));
  engine.on("exit", () => { engine = undefined; });
  engine.stdin.write("uci\nisready\n");
}
function command(cmd, match, timeout = 12000, collect = false) {
  return new Promise((resolve, reject) => {
    const w = { match, resolve, reject, collect, info: [], timer: setTimeout(() => {
      waiters = waiters.filter(x => x !== w);
      reject(new Error("Engine timed out"));
    }, timeout) };
    waiters.push(w);
    engine.stdin.write(cmd + "\n");
  });
}
async function analyse(body) {
  bootEngine();
  await command("isready", line => line === "readyok", 20000);
  const moves = body.moves ?? [];
  if (!Array.isArray(moves) || moves.length > 300 || moves.some(m => typeof m !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m))) {
    throw Object.assign(new Error("moves must be an array of UCI moves such as e2e4"), { status: 400 });
  }
  const fen = body.fen || "startpos";
  if (typeof fen !== "string" || fen.length > 200) throw Object.assign(new Error("Invalid FEN"), { status: 400 });
  const position = fen === "startpos"
    ? "position startpos" + (moves.length ? " moves " + moves.join(" ") : "")
    : "position fen " + fen + (moves.length ? " moves " + moves.join(" ") : "");
  const ms = Math.max(100, Math.min(MAX_MOVETIME, Number(body.movetime || 1000)));
  const depth = body.depth == null ? null : Math.max(1, Math.min(40, Math.floor(Number(body.depth))));
  engine.stdin.write(position + "\n");
  const infos = [];
  const w = { match: line => line.startsWith("bestmove "), resolve: line => resolveResult(line, infos), reject: null, collect: true, info: infos, timer: null };
  function resolveResult(line, collected) {
    const bestmove = line.split(/\s+/)[1];
    const finalInfo = collected.filter(x => x.startsWith("info ")).at(-1) || "";
    const depthMatch = finalInfo.match(/\bdepth (\d+)/);
    const nodesMatch = finalInfo.match(/\bnodes (\d+)/);
    const npsMatch = finalInfo.match(/\bnps (\d+)/);
    const scoreMatch = finalInfo.match(/\bscore (cp|mate) (-?\d+)/);
    return { bestmove, ponder: (line.match(/\bponder (\S+)/) || [])[1] || null,
      depth: depthMatch ? Number(depthMatch[1]) : null,
      nodes: nodesMatch ? Number(nodesMatch[1]) : null,
      nps: npsMatch ? Number(npsMatch[1]) : null,
      score: scoreMatch ? { type: scoreMatch[1], value: Number(scoreMatch[2]) } : null,
      info: collected.slice(-30) };
  }
  const resultPromise = new Promise((resolve, reject) => {
    w.resolve = line => { waiters = waiters.filter(x => x !== w); clearTimeout(w.timer); resolve(resolveResult(line, infos)); };
    w.reject = reject;
    w.timer = setTimeout(() => { waiters = waiters.filter(x => x !== w); reject(new Error("Engine timed out")); }, ms + 20000);
    waiters.push(w);
  });
  engine.stdin.write("go " + (depth ? "depth " + depth : "movetime " + ms) + "\n");
  return await resultPromise;
}
function enqueue(fn) {
  const task = queue.then(fn, fn);
  queue = task.catch(() => {});
  return task;
}
const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { status: "ok", engine: "Berserk", engineConfigured: true });
  }
  if (req.method === "GET" && url.pathname === "/") {
    return json(res, 200, { name: "Berserk Engine API", version: "1.0.0", endpoints: { "POST /v1/bestmove": "Get Berserk's move", "POST /v1/analyse": "Get a move and search info" } });
  }
  if (req.method !== "POST" || !["/v1/bestmove", "/v1/analyse"].includes(url.pathname)) {
    return json(res, 404, { error: "Not found" });
  }
  let raw = "";
  req.on("data", chunk => { raw += chunk; if (raw.length > 32000) req.destroy(); });
  req.on("end", async () => {
    let body;
    try { body = JSON.parse(raw || "{}"); } catch { return json(res, 400, { error: "Body must be valid JSON" }); }
    try {
      const result = await enqueue(() => analyse(body));
      return json(res, 200, result);
    } catch (err) {
      console.error(err);
      return json(res, err.status || 503, { error: err.message || "Engine request failed" });
    }
  });
});
server.listen(PORT, "0.0.0.0", () => console.log(`Berserk API listening on ${PORT}`));
