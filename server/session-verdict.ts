/**
 * What `/api/session` answers, as one decision instead of nested `if`s in
 * `handleApi`. Only a 401 says the credential is dead; a 502 is `unknown`,
 * and ADR 0019 forbids evicting on ambiguity — the next request asks again.
 */
import { HttpError } from "./http-error.js";
import type { Liveness } from "./portal-liveness.js";

export function sessionVerdict(
  liveness: Liveness,
  reauthFailure: unknown
): Liveness {
  if (liveness !== "dead") return liveness;
  if (reauthFailure === null) return "alive";
  return reauthFailure instanceof HttpError && reauthFailure.status === 401
    ? "dead"
    : "unknown";
}
