/**
 * The installed update as one explicit lifecycle: a first install (no old
 * shell to replace, so nothing to offer), a download in progress, a new shell
 * installed and waiting, and an update the reader accepted.
 *
 * A shell that finished downloading while the page was open (a `waiting`
 * handle at boot) and one that downloads during the visit (the installing
 * worker reaching `installed`) are the same phase — installed and waiting —
 * and reach the same offer through one decision. The native confirm and the
 * reload stay in the caller.
 */
export type UpdatePhase =
  | "first-install"
  | "downloading"
  | "installed-waiting"
  | "updating";

export type UpdateEvent =
  /** The registration was read at boot; a shell may already be waiting. */
  | { kind: "boot"; hasController: boolean; hasWaiting: boolean }
  /** A new worker started downloading during this visit. */
  | { kind: "updatefound" }
  /** The installing worker reported a state change. */
  | { kind: "worker-state"; state: string; hasController: boolean }
  /** The native confirm was answered. */
  | { kind: "answered"; confirmed: boolean };

export type UpdateAction =
  /** Attach the registration's updatefound listener. */
  | "listen"
  /** Attach a statechange listener to the installing worker. */
  | "watch"
  /** Ask through the native confirm. */
  | "offer"
  /** Reload onto the new shell. */
  | "apply"
  | "none";

export type UpdateStep = { phase: UpdatePhase; action: UpdateAction };

/** A visit starts with no knowledge of an update and no control over one. */
export const FIRST_PHASE: UpdatePhase = "first-install";

export function updateStep(phase: UpdatePhase, event: UpdateEvent): UpdateStep {
  if (event.kind === "boot") {
    // A waiting shell behind an old one is offered at once; that path ends
    // here, so no updatefound listener is attached (there is nothing to wait
    // for — the offer already covers it).
    if (event.hasWaiting && event.hasController)
      return { phase: "installed-waiting", action: "offer" };
    // With no old shell there is nothing a download could update, but the
    // registration is still watched; with one, we watch for the download.
    return {
      phase: event.hasController ? "downloading" : "first-install",
      action: "listen",
    };
  }
  if (event.kind === "updatefound") {
    // An offer already made, or an update being applied, owns the answer: a
    // second worker found behind it must not drop that offer for a download.
    if (phase === "installed-waiting" || phase === "updating")
      return { phase, action: "none" };
    return { phase: "downloading", action: "watch" };
  }
  if (event.kind === "worker-state") {
    // Only the worker this visit is watching may make an offer. A state change
    // after the offer was made or the update was accepted cannot ask a second
    // time — one question, one answer.
    if (phase !== "downloading") return { phase, action: "none" };
    if (event.state !== "installed") return { phase, action: "none" };
    return event.hasController
      ? { phase: "installed-waiting", action: "offer" }
      : { phase: "first-install", action: "none" };
  }
  if (phase !== "installed-waiting") return { phase, action: "none" };
  return event.confirmed
    ? { phase: "updating", action: "apply" }
    : { phase: "installed-waiting", action: "none" };
}
