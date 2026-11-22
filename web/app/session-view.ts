import type { SessionReply } from "../../shared/api";
import type { Note } from "./types";

/**
 * The app's own view of the session, as one state instead of two booleans.
 *
 * `booted` (has `/api/session` been asked?) and `signedIn` (what did it say?)
 * could be set independently, so "signed in before the boot check" was a state
 * the type allowed and nothing prevented. One union makes that unrepresentable,
 * and the two facts stay readable through the predicates below.
 *
 * `signedIn` is deliberately app state and not `session.data`: signing out has
 * to say so before the next read answers, or the guard drags the user back out
 * of the login form (ADR 0015).
 */
export type SessionView = "booting" | "signedOut" | "signedIn";

/** The boot read has answered, either way. */
export const isBooted = (view: SessionView): boolean => view !== "booting";

/** The app believes this visit has a working session. */
export const isSignedIn = (view: SessionView): boolean => view === "signedIn";

/** How the boot check ended without a session. Only a probe that never
 *  answered owes the form a note: a session that is simply absent is the
 *  expected answer on the sign-in screen. */
export type BootEnd = "probe-unanswered" | "signed-out";

/** The boot check's whole decision. The effect applies an action; it never
 *  decides which one applies, so the phases cannot drift into a third writer. */
export type BootAction =
  | { kind: "wait" }
  | { kind: "retry" }
  | { kind: "signOut"; end: BootEnd }
  | { kind: "signIn"; userId: string | null };

/**
 * The boot check as a transition table: waiting for the probe, retrying a
 * transport failure once, giving up, or answering with the session's own words.
 * A booted view waits for the rest of the app; only the unanswered probe may
 * spend the one retry, so a probe that fails twice ends the boot.
 */
export function bootStep(input: {
  booted: boolean;
  loading: boolean;
  data: SessionReply | undefined;
  retried: boolean;
}): BootAction {
  if (input.booted || input.loading) {
    return { kind: "wait" };
  }
  if (!input.data) {
    return input.retried
      ? { kind: "signOut", end: "probe-unanswered" }
      : { kind: "retry" };
  }
  return input.data.signedIn
    ? { kind: "signIn", userId: input.data.userId }
    : { kind: "signOut", end: "signed-out" };
}

/** The note the boot check owes the form for how it ended. */
export const bootNote = (end: BootEnd): Note | null =>
  end === "probe-unanswered"
    ? {
        kind: "warning",
        text: "ECAP did not answer. Sign in again if this screen does not go away.",
      }
    : null;
