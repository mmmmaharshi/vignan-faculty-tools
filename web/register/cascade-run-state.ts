import type { CascadeOutcome } from "./cascade-run";

/**
 * The cascade run as one named lifecycle. Only the current run may ask the
 * Portal further or write the screen; a newer change supersedes it, and a
 * failed run hands its partial options back beside the error.
 */
export type RunState =
  | { status: "idle" }
  | { status: "current"; controller: AbortController }
  | { status: "superseded" }
  | { status: "failed" };

export type CascadeRun = {
  /** Takes over the screen, stopping the run before this one. */
  start: () => AbortSignal;
  /** Whether a run still owns the screen and may write to it. */
  owns: (signal: AbortSignal) => boolean;
  /** Ends the current run without replacing it — the sign-out sweep. */
  supersede: () => void;
  /** Keeps a failed run's partial options, if it still owns the screen. */
  keepPartial: (
    signal: AbortSignal,
    partial: CascadeOutcome | null
  ) => CascadeOutcome | null;
  /** Releases the screen if this run still owns it. */
  finish: (signal: AbortSignal) => boolean;
};

export function createCascadeRun(): CascadeRun {
  let state: RunState = { status: "idle" };
  const owns = (signal: AbortSignal): boolean =>
    state.status === "current" && state.controller.signal === signal;
  return {
    start: () => {
      if (state.status === "current") state.controller.abort();
      const controller = new AbortController();
      state = { status: "current", controller };
      return controller.signal;
    },
    owns,
    supersede: () => {
      if (state.status === "current") state.controller.abort();
      state = { status: "superseded" };
    },
    keepPartial: (signal, partial) => {
      if (!owns(signal) || !partial) return null;
      state = { status: "failed" };
      return partial;
    },
    finish: (signal) => {
      if (!owns(signal)) return false;
      state = { status: "idle" };
      return true;
    },
  };
}
