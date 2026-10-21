import { sanitizeProfileFailure, type ProfileFailure } from "./sdk-profile-failure.js";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NinebotAuthDiagnosticEvent } from "@jiuhao/ninebot-client";

export type ReadOperation = "vehicles" | "snapshot" | "ride-month" | "ride-detail";
export type CacheOutcome =
  | "hit"
  | "joined"
  | "upstream-started"
  | "upstream-completed"
  | "upstream-failed"
  | "discarded";
export type RuntimeDiagnosticEvent =
  | { category: "profile-failure"; failure: ProfileFailure }
  | { category: "auth"; event: Readonly<NinebotAuthDiagnosticEvent> }
  | { category: "read"; operation: ReadOperation; outcome: "started" | "completed" | "failed" }
  | { category: "cache"; operation: ReadOperation; outcome: CacheOutcome };
export type RuntimeDiagnosticObserver = (event: RuntimeDiagnosticEvent) => void;

/** Logging must never change a read result, cache behavior or authentication. */
export const emitRuntimeDiagnostic = (
  observer: RuntimeDiagnosticObserver | undefined,
  event: RuntimeDiagnosticEvent,
) => {
  try {
    if (observer) void Promise.resolve(observer(event)).catch(() => undefined);
  } catch {
    /* Optional diagnostics cannot fail a product operation. */
  }
};

// Reconstruct an explicit allow-list; accidental extra fields cannot enter persisted snapshots.
const safeEvent = (input: RuntimeDiagnosticEvent): RuntimeDiagnosticEvent => {
  if (input.category === "profile-failure")
    return { category: "profile-failure", failure: sanitizeProfileFailure(input.failure) };
  if (input.category === "auth") {
    const event = input.event;
    if (event.kind === "eligibility") {
      return {
        category: "auth",
        event: {
          kind: "eligibility",
          source: event.source,
          status: event.status,
          refreshSupported: event.refreshSupported,
          nextEligibleAtMs: Number.isFinite(event.nextEligibleAtMs) ? event.nextEligibleAtMs : null,
        },
      };
    }
    if (event.operation === "refresh") {
      return {
        category: "auth",
        event: {
          kind: "operation",
          operation: "refresh",
          outcome: event.outcome,
          trigger: event.trigger,
        },
      };
    }
    return {
      category: "auth",
      event: {
        kind: "operation",
        operation: event.operation,
        outcome: event.outcome,
        ...(event.sessionPresent === undefined ? {} : { sessionPresent: event.sessionPresent }),
      },
    };
  }
  if (input.category === "read")
    return { category: "read", operation: input.operation, outcome: input.outcome };
  return { category: "cache", operation: input.operation, outcome: input.outcome };
};

const signalKey = (event: RuntimeDiagnosticEvent) => {
  if (event.category === "profile-failure")
    return `profile-failure.${event.failure.kind}.${event.failure.reason}`;
  if (event.category !== "auth") return `${event.category}.${event.operation}.${event.outcome}`;
  if (event.event.kind === "eligibility") return `auth.eligibility.${event.event.status}`;
  return `auth.${event.event.operation}.${event.event.outcome}${event.event.operation === "refresh" ? `.${event.event.trigger}` : ""}`;
};

/** Bounded non-secret journal plus persistent counters/order for completion signals. */
export const createRuntimeDiagnosticCollector = (now: () => number = Date.now) => {
  const state = {
    schemaVersion: 1,
    processId: process.pid,
    collectorStartedAtMs: now(),
    sequence: 0,
    latestEligibility: null as null | {
      sequence: number;
      observedAtMs: number;
      decision: Extract<NinebotAuthDiagnosticEvent, { kind: "eligibility" }>;
    },
    signals: {} as Record<
      string,
      { count: number; lastSequence: number; lastObservedAtMs: number }
    >,
    events: [] as { sequence: number; observedAtMs: number; event: RuntimeDiagnosticEvent }[],
  };
  return {
    record(input: RuntimeDiagnosticEvent) {
      const event = safeEvent(input);
      const sequence = ++state.sequence;
      const observedAtMs = now();
      if (event.category === "auth" && event.event.kind === "eligibility") {
        state.latestEligibility = { sequence, observedAtMs, decision: event.event };
      }
      const key = signalKey(event);
      const entry = state.signals[key] ?? { count: 0, lastSequence: 0, lastObservedAtMs: 0 };
      state.signals[key] = {
        count: entry.count + 1,
        lastSequence: sequence,
        lastObservedAtMs: observedAtMs,
      };
      state.events.push({ sequence, observedAtMs, event });
      if (state.events.length > 64) state.events.shift();
    },
    snapshot: () => structuredClone(state),
  };
};

/** Explicit SDK opt-in only. Never loads credentials, old sessions, responses or existing logs. */
export const createFileRuntimeDiagnostics = ({
  directory,
  enabled,
}: {
  directory: string;
  enabled: boolean;
}) => {
  const collector = createRuntimeDiagnosticCollector();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<boolean> = Promise.resolve(true);
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!enabled) return Promise.resolve(true);
    const snapshot = collector.snapshot();
    pending = pending.then(async () => {
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, "runtime-diagnostics.json");
        const temporary = `${path}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
        await chmod(temporary, 0o600);
        await rename(temporary, path);
        return true;
      } catch {
        return false;
      }
    });
    return pending;
  };
  return {
    record(event: RuntimeDiagnosticEvent) {
      if (!enabled) return;
      collector.record(event);
      if (!timer) {
        timer = setTimeout(() => {
          timer = undefined;
          void flush();
        }, 150);
        timer.unref();
      }
    },
    flush,
  };
};
