/**
 * Berserk browser client for Berserk Web.
 *
 * The actual WebAssembly binary and worker are served by the Berserk-web
 * repository. Keep this URL in sync with the published engine asset:
 * https://github.com/official-knightly/Berserk-web/tree/main/engine
 */
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

export type EngineState = {
  status: EngineStatus;
  progress: number;
  error?: string;
};

type Listener = (state: EngineState) => void;

type PendingSearch = {
  resolve: (result: SearchResult) => void;
  reject: (error: Error) => void;
};

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.length > 0) return new Error(value);
  return new Error(fallback);
}

function clampInteger(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(minimum, Math.min(maximum, rounded));
}

/**
 * Talks to Berserk Web's existing /engine/engine-worker.js.
 * The worker downloads and validates the remote LFS-backed WASM binary.
 */
class BerserkEngine {
  private worker: Worker | null = null;
  private pending = new Map<number, PendingSearch>();
  private sequence = 0;
  private startup: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  status: EngineStatus = "idle";
  progress = 0;
  error?: string;
  ready: Promise<void> = Promise.resolve();

  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private snapshot(): EngineState {
    return {
      status: this.status,
      progress: this.progress,
      error: this.error,
    };
  }

  private emit(): void {
    const state = this.snapshot();
    this.listeners.forEach((listener) => listener(state));
  }

  start(): Promise<void> {
    if (this.startup) return this.startup;
    if (this.worker && this.status === "ready") return Promise.resolve();

    if (typeof Worker === "undefined") {
      const error = new Error(
        "Berserk requires browser Web Worker support.",
      );
      this.fail(error.message);
      return Promise.reject(error);
    }

    this.status = "loading";
    this.progress = 0;
    this.error = undefined;
    this.emit();

    let worker: Worker;
    try {
      worker = new Worker("/engine/engine-worker.js", {
        type: "module",
        name: "Berserk-WASM",
      });
    } catch (cause) {
      const error = asError(cause, "Could not create the Berserk worker.");
      this.fail(error.message);
      return Promise.reject(error);
    }

    this.worker = worker;

    const startup = new Promise<void>((resolve, reject) => {
      let settled = false;

      const rejectStartup = (error: Error): void => {
        this.fail(error.message);
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      worker.onmessage = (event: MessageEvent) => {
        const message = event.data || {};

        if (message.type === "ready") {
          if (!settled) {
            settled = true;
            this.status = "ready";
            this.progress = 1;
            this.error = undefined;
            this.emit();
            resolve();
          }
          return;
        }

        if (message.type === "progress") {
          const loaded = Number(message.loaded) || 0;
          const total = Number(message.total) || 0;
          this.progress = total
            ? Math.min(0.99, Math.max(0, loaded / total))
            : Math.min(0.95, Math.max(0, loaded / 64_000_000));
          this.emit();
          return;
        }

        if (message.type === "init-error") {
          rejectStartup(
            new Error(message.error || "Berserk WASM initialization failed."),
          );
          return;
        }

        if (message.type === "result" || message.type === "search-error") {
          const pending = this.pending.get(message.id);
          if (!pending) return;

          this.pending.delete(message.id);

          if (message.type === "search-error") {
            pending.reject(
              new Error(message.error || "Berserk search failed."),
            );
          } else {
            pending.resolve(message as SearchResult);
          }
        }
      };

      worker.onerror = (event: ErrorEvent) => {
        const error = new Error(
          event.message || "The Berserk WebAssembly worker failed.",
        );
        rejectStartup(error);
      };

      try {
        worker.postMessage({ type: "init", wasmUrl: WASM_URL });
      } catch (cause) {
        rejectStartup(asError(cause, "Could not initialize the Berserk worker."));
      }
    });

    this.startup = startup;
    this.ready = startup;

    // A failed initialization can be retried by the next start/search call.
    void startup.catch(() => {
      if (this.startup === startup) this.startup = null;
    });

    return startup;
  }

  private fail(message: string): void {
    this.status = "error";
    this.error = message;
    this.emit();

    const worker = this.worker;
    this.worker = null;
    this.startup = null;
    worker?.terminate();

    this.pending.forEach((pending) => pending.reject(new Error(message)));
    this.pending.clear();
  }

  /**
   * Searches are serialized because the WASM search runs synchronously
   * inside the worker.
   */
  search(
    fen: string,
    milliseconds: number,
    multiPV = 1,
  ): Promise<SearchResult> {
    const run = async (): Promise<SearchResult> => {
      await this.start();

      const worker = this.worker;
      if (!worker) {
        throw new Error("Berserk worker is unavailable.");
      }

      const id = ++this.sequence;
      const safeMilliseconds = clampInteger(milliseconds, 100, 10_000, 1_000);
      const safeMultiPV = clampInteger(multiPV, 1, 8, 1);

      return new Promise<SearchResult>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });

        try {
          worker.postMessage({
            type: "search",
            id,
            fen,
            milliseconds: safeMilliseconds,
            multiPV: safeMultiPV,
          });
        } catch (cause) {
          this.pending.delete(id);
          reject(asError(cause, "Could not send the search to Berserk."));
        }
      });
    };

    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

export const engine = new BerserkEngine();
