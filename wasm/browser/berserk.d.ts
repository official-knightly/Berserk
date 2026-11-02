export const WASM_URL =
  "https://media.githubusercontent.com/media/official-knightly/Berserk-web/main/engine/berserk_bg.wasm";

export type Candidate = {
  rank: number;
  depth: number;
  uci: string;
  pv: string[];
  scoreCp: number;
  mate: number | null;
};

export type SearchResult = {
  bestmove: string;
  scoreCp: number;
  depth: number;
  nodes: string;
  candidates: Candidate[];
};

export type EngineStatus = "idle" | "loading" | "ready" | "error";

type Listener = (s: {
  status: EngineStatus;
  progress: number;
  error?: string;
}) => void;

class BerserkEngine {
  private worker: Worker | null = null;
  private pending = new Map<
    number,
    {
      resolve: (r: SearchResult) => void;
      reject: (e: Error) => void;
    }
  >();
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  status: EngineStatus = "idle";
  progress = 0;
  error?: string;
  private listeners = new Set<Listener>();
  ready!: Promise<void>;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn({
      status: this.status,
      progress: this.progress,
      error: this.error,
    });
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((listener) =>
      listener({
        status: this.status,
        progress: this.progress,
        error: this.error,
      }),
    );
  }

  start() {
    if (this.worker || typeof window === "undefined") return this.ready;

    this.status = "loading";
    this.emit();

    this.ready = new Promise<void>((resolve, reject) => {
      const worker = new Worker("/engine/engine-worker.js", {
        type: "module",
        name: "Berserk-WASM",
      });

      this.worker = worker;

      worker.onmessage = (event) => {
        const message = event.data || {};

        if (message.type === "ready") {
          this.status = "ready";
          this.progress = 1;
          this.emit();
          resolve();
        } else if (message.type === "progress") {
          this.progress = message.total
            ? message.loaded / message.total
            : Math.min(0.95, message.loaded / 64_000_000);
          this.emit();
        } else if (message.type === "init-error") {
          this.fail(message.error || "Berserk WASM initialization failed.");
          reject(new Error(this.error));
        } else if (
          message.type === "result" ||
          message.type === "search-error"
        ) {
          const pending = this.pending.get(message.id);
          if (!pending) return;

          this.pending.delete(message.id);

          if (message.type === "search-error") {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve(message as SearchResult);
          }
        }
      };

      worker.onerror = (event) => {
        this.fail(event.message || "Berserk worker failed.");
        reject(new Error(this.error));
      };

      worker.postMessage({ type: "init", wasmUrl: WASM_URL });
    });

    this.ready.catch(() => {});
    return this.ready;
  }

  private fail(message: string) {
    this.status = "error";
    this.error = message;
    this.emit();

    this.pending.forEach((pending) =>
      pending.reject(new Error(message)),
    );
    this.pending.clear();
  }

  /** Searches are serialized because WASM search is synchronous in the worker. */
  search(
    fen: string,
    milliseconds: number,
    multiPV = 1,
  ): Promise<SearchResult> {
    const run = async () => {
      await this.start();

      if (!this.worker) {
        throw new Error("Berserk worker is unavailable.");
      }

      const id = ++this.seq;

      return new Promise<SearchResult>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });

        this.worker!.postMessage({
          type: "search",
          id,
          fen,
          milliseconds: Math.max(
            100,
            Math.min(10_000, Math.round(milliseconds)),
          ),
          multiPV: Math.max(1, Math.min(8, Math.round(multiPV))),
        });
      });
    };

    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
}

export const engine = new BerserkEngine();
