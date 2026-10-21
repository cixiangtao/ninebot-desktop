import type { CacheOutcome } from "./runtime-diagnostics.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Deduplicates identical reads and retains successful domain objects in memory for a short TTL. */
export class SessionReadCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private generation = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly onDiagnostic?: (outcome: CacheOutcome) => void,
  ) {}

  private emit(outcome: CacheOutcome) {
    try {
      if (this.onDiagnostic)
        void Promise.resolve(this.onDiagnostic(outcome)).catch(() => undefined);
    } catch {
      /* Optional diagnostics cannot affect cache results. */
    }
  }

  /**
   * Reads a key without ever persisting its value to disk.
   *
   * @param force - Bypasses a completed cache entry, while still joining an identical in-flight read.
   */
  async read(key: string, ttlMs: number, loader: () => Promise<T>, force = false): Promise<T> {
    const activeRead = this.inFlight.get(key);
    if (activeRead) {
      this.emit("joined");
      return activeRead;
    }

    const cached = this.entries.get(key);
    const readAt = this.now();
    if (!force && cached && cached.expiresAt > readAt) {
      this.emit("hit");
      return cached.value;
    }

    const loadGeneration = this.generation;
    this.emit("upstream-started");
    let loading: Promise<T>;
    try {
      loading = loader();
    } catch (error) {
      this.emit("upstream-failed");
      throw error;
    }
    const pending = loading
      .then((value) => {
        if (loadGeneration === this.generation) {
          this.emit("upstream-completed");
          this.entries.set(key, {
            value,
            expiresAt: this.now() + Math.max(0, ttlMs),
          });
        } else this.emit("discarded");
        return value;
      })
      .catch((error: unknown) => {
        this.emit("upstream-failed");
        throw error;
      })
      .finally(() => {
        if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
      });
    this.inFlight.set(key, pending);
    return pending;
  }

  /** Drops all completed and in-flight references; older promises cannot repopulate the cache. */
  clear() {
    this.generation += 1;
    this.entries.clear();
    this.inFlight.clear();
  }
}
