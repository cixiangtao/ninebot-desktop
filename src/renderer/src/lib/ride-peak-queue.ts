import type { RideSpeedVerification } from "../../../shared/contracts";

export interface RidePeakQueueState {
  loading: boolean;
  failedCount: number;
  error: string | null;
}

/** Viewport-first reads, bounded across scope changes. Failures require an explicit retry. */
export class RidePeakQueue {
  private generation = 0;
  private active = 0;
  private visible: string[] = [];
  private requested: string[] = [];
  private attempted = new Set<string>();
  private completed = new Set<string>();
  private failures = new Map<string, string>();
  private running = new Set<string>();
  private load: ((id: string) => Promise<RideSpeedVerification>) | null = null;

  constructor(
    private readonly onRead: (reading: RideSpeedVerification) => void,
    private readonly onState: (state: RidePeakQueueState) => void,
  ) {}

  /** Replaces viewport demand; offscreen jobs that have not started are dropped. */
  update(
    visible: string[],
    known: Readonly<Record<string, RideSpeedVerification>>,
    load: ((id: string) => Promise<RideSpeedVerification>) | null,
  ) {
    this.visible = visible;
    this.load = load;
    for (const id of Object.keys(known)) {
      this.completed.add(id);
      this.failures.delete(id);
    }
    this.pump();
  }

  /** Manual full-month completion uses the same queue and retries failed, unread records. */
  requestAll(ids: string[]) {
    this.requested = ids;
    for (const id of ids) {
      if (!this.failures.has(id)) continue;
      this.failures.delete(id);
      this.attempted.delete(id);
    }
    this.pump();
  }

  /** In-flight IPC cannot be aborted; keep its slot occupied but discard its eventual result. */
  reset(notify = true) {
    this.generation += 1;
    this.visible = [];
    this.requested = [];
    this.attempted.clear();
    this.completed.clear();
    this.failures.clear();
    this.running.clear();
    this.load = null;
    if (notify) this.emit();
  }

  private emit() {
    this.onState({
      loading: this.running.size > 0,
      failedCount: this.failures.size,
      error: this.failures.values().next().value ?? null,
    });
  }

  private pump() {
    const candidates = [...new Set([...this.visible, ...this.requested])];
    for (const id of candidates) {
      if (!this.load || this.active >= 2) break;
      if (this.attempted.has(id) || this.completed.has(id)) continue;
      const generation = this.generation;
      const load = this.load;
      this.attempted.add(id);
      this.running.add(id);
      this.active += 1;
      void Promise.resolve()
        .then(() => load(id))
        .then((reading) => {
          if (generation !== this.generation) return;
          if (reading.id !== id) throw new Error("轨迹返回的行程不匹配。");
          this.completed.add(id);
          this.onRead(reading);
        })
        .catch((cause: unknown) => {
          if (generation !== this.generation || this.completed.has(id)) return;
          this.failures.set(id, cause instanceof Error ? cause.message : "轨迹读取失败。");
        })
        .finally(() => {
          this.active -= 1;
          if (generation === this.generation) this.running.delete(id);
          this.pump();
        });
    }
    this.emit();
  }
}
