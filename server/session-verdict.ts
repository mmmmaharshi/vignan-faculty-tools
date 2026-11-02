/**
 * What `/api/session` answers, as one decision instead of nested `if`s in
 * `handleApi`. Only a 401 says the credential is dead; a 502 is `unknown`,
 * and ADR 0019 forbids evicting on ambiguity — the next request asks again.
 */
export type SessionVerdict = "alive" | "dead" | "unknown";

export function sessionVerdict(
  liveness: SessionVerdict,
  reauthFailure: { status: number } | null
): SessionVerdict {
  if (liveness === "alive") return "alive";
  if (liveness === "unknown") return "unknown";
  if (reauthFailure === null) return "alive";
  return reauthFailure.status === 401 ? "dead" : "unknown";
}
