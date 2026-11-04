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
