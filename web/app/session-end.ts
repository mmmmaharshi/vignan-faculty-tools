import type { BootEnd } from "./session-view";
import { bootNote } from "./session-view";
import type { Note } from "./types";

/**
 * Why the app's view of the session ended, as one named reason. One writer
 * applies the reason; the two policies below say what it owes the next screen
 * and the stored credential.
 */
export type SessionEnd =
  | { kind: "signed-out" }
  | { kind: "expired" }
  | { kind: "boot"; end: BootEnd };

const EXPIRED_NOTE: Note = {
  kind: "warning",
  text: "Your session expired. Please sign in again.",
};

/** The note the sign-in form is owed. A deliberate sign-out and a boot that
 *  found no session are the expected answers, so neither says anything. */
export function endNote(end: SessionEnd): Note | null {
  if (end.kind === "expired") return EXPIRED_NOTE;
  return end.kind === "boot" ? bootNote(end.end) : null;
}

/** A boot that never answered may still hold a working session, and clearing
 *  the credential would re-key the probe on every signed-out boot. Both boot
 *  ends keep it; a deliberate sign-out or an expiry drops it. */
export const keepsCredential = (end: SessionEnd): boolean =>
  end.kind === "boot";
