/**
 * Whether an options call has touched ECAP, as a named state and one action.
 * A call that reused every held list has not proved the session, so answering
 * it with a 200 would tell a signed-out browser its session still works. The
 * decision is stated here; the handler only applies it.
 */

export type OptionsTouch = { kind: "untouched" } | { kind: "touched" };

export const untouched: OptionsTouch = { kind: "untouched" };

/** Any Portal read this call makes marks it as its own liveness proof. */
export const markTouched = (): OptionsTouch => ({ kind: "touched" });

export type LivenessAction = { kind: "answer" } | { kind: "probe" };

export function livenessGuard(touch: OptionsTouch): LivenessAction {
  return touch.kind === "touched" ? { kind: "answer" } : { kind: "probe" };
}
