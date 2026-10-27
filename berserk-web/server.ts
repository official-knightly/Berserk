import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { Chess } from "chess.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultEngineName = process.platform === "win32" ? "berserk.exe" : "berserk";
const ENGINE_PATH = process.env.ENGINE_PATH
  ? path.resolve(process.env.ENGINE_PATH)
  : path.resolve(here, "..", "target", "release", defaultEngineName);
const PORT = Number(process.env.PORT ?? 3000);
const MAX_MOVETIME = 5000;
const DEFAULT_MOVETIME = 1000;
const app = express();

type Waiter = { test: (line: string) => boolean; resolve: (line: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
class UciEngine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private waiters = new Set<Waiter>();
  private queue: Promise<unknown> = Promise.resolve();
  private infoLines: string[] = [];
  private ready = false;
  private shuttingDown = false;

  get running() { return !!this.child && this.child.exitCode === null && !this.child.killed; }

  initialize(): Promise<void> { return this.start(); }

  shutdown() {
    this.shuttingDown = true;
    const child = this.child;
    this.child = null;
    this.ready = false;
    for (const waiter of [...this.waiters]) waiter.reject(new Error("API is shutting down"));
    if (child && child.exitCode === null) child.kill();
  }

  private send(command: string) {
    if (!this.running || !this.child) throw new Error("Engine process is not running");
    this.child.stdin.write(command + "\n");
  }

  private waitFor(test: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        test,
        resolve: (line) => { clearTimeout(waiter.timer); this.waiters.delete(waiter); resolve(line); },
        reject: (error) => { clearTimeout(waiter.timer); this.waiters.delete(waiter); reject(error); },
        timer: setTimeout(() => { this.waiters.delete(waiter); reject(new Error("Timed out waiting for UCI engine")); }, timeoutMs)
      };
      this.waiters.add(waiter);
    });
  }

  private onLine(line: string) {
    const s = line.trim();
    if (!s) return;
    if (s.startsWith("info ")) this.infoLines.push(s);
    for (const w of [...this.waiters]) {
      try { if (w.test(s)) w.resolve(s); } catch (e) { w.reject(e instanceof Error ? e : new Error(String(e))); }
    }
  }

  private fail(error: Error) {
    this.ready = false;
    for (const w of [...this.waiters]) w.reject(error);
    this.child = null;
    this.startPromise = null;
  }

  private async start(): Promise<void> {
    if (this.shuttingDown) throw new Error("API is shutting down");
    if (this.running && this.ready) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      const child = spawn(ENGINE_PATH, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      this.child = child;
      child.stdout.setEncoding("utf8");
      createInterface({ input: child.stdout }).on("line", line => this.onLine(line));
      child.stderr.setEncoding("utf8");
      createInterface({ input: child.stderr }).on("line", line => console.error("[berserk stderr]", line));
      child.once("error", err => this.fail(new Error("Unable to start engine: " + err.message)));
      child.once("exit", (code, signal) => {
        if (this.child === child) {
          this.fail(new Error(`Engine exited (code=${code}, signal=${signal})`));
          // Restart after an unexpected exit; the next request also awaits startup.
          if (!this.shuttingDown) {
            setTimeout(() => {
              if (!this.shuttingDown) void this.start().catch(error => console.error("[engine restart]", error));
            }, 1000).unref();
          }
        }
      });
      const uciOk = this.waitFor(line => line === "uciok", 15000);
      child.stdin.write("uci\n");
      await uciOk;
      const readyOk = this.waitFor(line => line === "readyok", 10000);
      child.stdin.write("isready\n");
      await readyOk;
      if (this.child !== child) throw new Error("Engine exited during startup");
      this.ready = true;
      console.log("Berserk UCI engine ready:", ENGINE_PATH);
    })();
    try { await this.startPromise; }
    catch (e) { this.fail(e instanceof Error ? e : new Error(String(e))); throw e; }
    finally { this.startPromise = null; }
  }

  bestMove(fen: string, movetime: number): Promise<{ bestmove: string; info: string }> {
    const job = async () => {
      await this.start();
      this.infoLines = [];
      this.send("ucinewgame");
      const ready = this.waitFor(line => line === "readyok", 10000);
      this.send("isready");
      await ready;
      this.send("position fen " + fen);
      const done = this.waitFor(line => line.startsWith("bestmove "), movetime + 20000);
      this.send("go movetime " + movetime);
      const result = await done;
      const tokens = result.split(/\s+/);
      const bestmove = tokens[1];
      if (!bestmove || bestmove === "(none)") throw new Error("Engine returned no legal best move");
      return { bestmove, info: this.infoLines.join("\n") };
    };
    const result = this.queue.then(job, job);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

const engine = new UciEngine();
app.disable("x-powered-by");
app.use(cors({ origin: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "16kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Rate limit exceeded; try again later." } }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "berserk-api", engineRunning: engine.running });
});

app.post("/bestmove", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { fen?: unknown; movetime?: unknown } | null;
    if (!body || typeof body.fen !== "string" || body.fen.length > 200) {
      res.status(400).json({ error: "Body must contain a valid fen string." }); return;
    }
    try { new Chess(body.fen); }
    catch { res.status(400).json({ error: "Invalid FEN position." }); return; }
    if (body.movetime !== undefined && (typeof body.movetime !== "number" || !Number.isFinite(body.movetime) || body.movetime <= 0)) {
      res.status(400).json({ error: "movetime must be a positive number of milliseconds." }); return;
    }
    const movetime = Math.min(MAX_MOVETIME, Math.max(1, Math.floor((body.movetime as number | undefined) ?? DEFAULT_MOVETIME)));
    const result = await engine.bestMove(body.fen, movetime);
    res.json(result);
  } catch (error) { next(error); }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api error]", err);
  if (res.headersSent) return;
  res.status(503).json({ error: "Engine temporarily unavailable. Please retry." });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Berserk API listening on port ${PORT}`);
  void engine.initialize().catch(error => console.error("[engine startup]", error));
});
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  engine.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
