import { messageOf } from "../shared/portal-values.js";
/**
 * The refusal a route handler throws, and the two rules every caller applies to
 * one. It lives apart from the reply parsers because it is the more stable
 * thing: a parser changes when ECAP's markup does, this changes when the
 * server's own answer does, and the liveness probe needs it without needing any
 * parser.
 */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}
/** The one refusal a dead ECAP session earns, wherever it is met, so the
 *  sentence the user sees cannot drift per call site. */
export const sessionExpired = (): HttpError =>
  new HttpError(401, "Your ECAP session expired. Please sign in again.");
/** A reply that is not the page it must be: ECAP answered, but in a shape
 *  nothing here can read. Named so two handlers cannot word it differently. */
export const unreadablePage = (what: string): HttpError =>
  new HttpError(
    502,
    `ECAP's ${what} came back in an unexpected shape, so it could not be read.`
  );
/**
 * A dead ECAP session must stay a 401 so the client signs out; every other
 * portal failure is the caller's to interpret. The one place that rule lives,
 * so the readers cannot drift apart on it.
 */
export function rethrowExpired(error: unknown): void {
  if (error instanceof HttpError && error.status === 401) throw error;
}

/**
 * A thrown failure as the refusal the answer states: one already named keeps
 * its status and sentence, anything else becomes the 502 ECAP's own words
 * earn. Signing in is asked twice — at the form and again to revive a session
 * — and both answers must read the same way.
 */
export function refusalOf(error: unknown): HttpError {
  return error instanceof HttpError
    ? error
    : new HttpError(502, messageOf(error));
}
