/**
 * Sessions in the OS credential vault, so a restart does not sign you out.
 *
 * ## What is stored
 *
 * The session cookie jars — ECAP's `ASP.NET_SessionId` and `frmAuth` — plus each
 * session's last-seen timestamp. **Not the password.** The password is used once
 * to encrypt the login payload and is discarded, so "your password is never
 * written to disk" stays literally true. What is stored is the token ECAP issues
 * after a successful sign-in, which the server was already holding in memory and
 * already sending on every request.
 *
 * ## Why the vault and not a file
 *
 * `Bun.secrets` is already installed — no new dependency, and it is Bun's own API
 * rather than a hand-rolled crypto scheme. On Windows it is Credential Manager
 * (`CredWriteW`/`CredReadW`, `CRED_TYPE_GENERIC`), which Microsoft ranks *above*
 * DPAPI in its own guidance.
 *
 * It was measured on this build before being relied on, because a store that
 * quietly corrupts a token presents as "my session stopped working" with nothing
 * to look at:
 *
 * - **Byte-exact round trips** for plain text, hex tokens, multi-byte characters,
 *   a high code unit, padded whitespace, and a 384-character token — the exact
 *   shape `frmAuth` has. Bun's issue #24135 (a NUL after every character on
 *   Windows) does **not** reproduce here, and is unreachable anyway: `set()`
 *   refuses a NUL outright with `ERR_INVALID_ARG_VALUE`.
 * - `persist: "local"` is accepted at runtime and read back.
 *
 * **What the vault does not do**, so it is not oversold: a *separate* process
 * running as the same user reads an entry back without complaint. Credential
 * Manager is not a process boundary. The threat model is the same as a file in
 * `%LOCALAPPDATA%` — anything already running as this user can ask. What the vault
 * genuinely narrows is **at-rest** exposure: backups, cloud sync, disk imaging,
 * and other tools that read files.
 *
 * ## One entry, because the vault cannot be listed
 *
 * `Bun.secrets` has `get`, `set` and `delete` — and **no way to enumerate**. So
 * there is nothing to iterate at boot, which rules out one entry per session and
 * the index file that would then be needed to find them.
 *
 * Everything therefore lives in a single fixed entry. The cost is that the whole
 * set is read and rewritten together, and the benefit is that there is no index
 * to fall out of step with the entries it points at — which is the failure a
 * file-per-session design has to be careful about and this one cannot have.
 *
 * Validation is still per session, so one unreadable session costs that session
 * and not the rest. See ADR 0014.
 *
 * ## Why this cannot promise 30 days
 *
 * A spike against the live portal settled this, and the number in
 * `SESSION_TTL_MS` is misleading on its own. ECAP issues **both** cookies as
 * session cookies — no `Expires`, no `Max-Age` — and a jar with `frmAuth` but no
 * `ASP.NET_SessionId` is rejected, as is the reverse. The credential is bound to
 * ECAP's **in-memory ASP.NET session**, not to the token. Once that session ends,
 * nothing stored anywhere brings it back.
 *
 * Our TTL is an upper bound, never a promise. What persistence buys is the case
 * the user actually asked for: **restarting our own server**, which says nothing
 * about how long ECAP's session lasts.
 *
 * ## Module rules
 *
 * Importing this file touches no disk and no vault. The backend is passed in, so
 * the credential-free test suite injects a fake and never touches the real
 * Windows Credential Manager. `bunSecrets()` below is the only code that does, and
 * `server.ts` is its only caller.
 */
import { CookieJar } from "./portal-conventions";

/** One session, reduced to what a restart needs. Cookies are name/value pairs. */
export type StoredSession = {
  id: string;
  at: number;
  cookies: [string, string][];
};

/**
 * The vault operations this module needs.
 *
 * `delete` is here because a session that has ended must have its entry removed,
 * or the store accumulates an orphan for every sign-out the user ever performed.
 * The fake in the tests implements all three, and production is the only caller.
 */
export type Secrets = {
  get: (name: string) => Promise<string | null>;
  set: (name: string, value: string) => Promise<void>;
  delete: (name: string) => Promise<boolean>;
};

/**
 * The service name, and the one entry inside it that is not a session.
 *
 * ## One entry per session, and why there is an index
 *
 * `Bun.secrets` has `get`, `set` and `delete` — and **no way to enumerate**, so
 * something has to say which entries exist. That is this list of ids.
 *
 * The obvious alternative — everything in one entry — is what this used to do, and
 * it fails. On Windows a generic credential's blob is capped at
 * `CRED_MAX_CREDENTIAL_BLOB_SIZE` = 5 × 512 = **2560 bytes**, and a session is
 * ~526 bytes of JSON once the portal's 384-character `frmAuth` is in it. Measured
 * on this build:
 *
 * ```
 *  1 session  =  526 bytes  OK
 *  4 sessions = 2101 bytes  OK
 *  5 sessions = 2626 bytes  REJECTED: The stub received bad data. (code: 1783)
 * ```
 *
 * That is a silent ceiling. `saveSessions` reports the failure rather than
 * throwing, the server carries on serving, and persistence simply stops working
 * after the fifth sign-in from another browser — with nothing on screen to say so.
 * One entry per session puts each one comfortably under the cap, and leaves the
 * index holding only ids: 39 bytes each, so the cap is not reached until roughly
 * sixty sessions, which for a single-user local app is not a real limit.
 *
 * The index is written **after** the sessions it names, deliberately. The reverse
 * order would let a failure leave an index pointing at entries that were never
 * written, which drops live sessions; this way a failure leaves an orphan entry
 * that nothing references and nobody misses.
 */
export const VAULT_SERVICE = "ecap-attendance-app";
export const VAULT_INDEX = "sessions";

/** The entry name for one session. Exported so tests can address one directly. */
export function sessionKey(id: string): string {
  return `session-${id}`;
}

/**
 * `Bun.secrets`, or null if this build or platform has none.
 *
 * Returning null rather than throwing is the point: persistence is a
 * convenience, so a runtime without it must fall back to in-memory sessions —
 * today's behaviour — instead of refusing to start.
 */
export function bunSecrets(): Secrets | null {
  const raw = (Bun as unknown as { secrets?: unknown }).secrets as
    | {
        get: (q: { service: string; name: string }) => Promise<string | null>;
        set: (q: {
          service: string;
          name: string;
          value: string;
          persist?: string;
        }) => Promise<unknown>;
        delete: (q: { service: string; name: string }) => Promise<boolean>;
      }
    | undefined;
  if (!raw) return null;
  return {
    get: (name) => raw.get({ service: VAULT_SERVICE, name }),
    // `persist: "local"` keeps the entry across reboots. It is not declared in
    // bun-types@1.4.2 and was verified at runtime on this build; without it the
    // entry would not outlive a restart, which is the entire feature.
    set: async (name, value) => {
      await raw.set({ service: VAULT_SERVICE, name, value, persist: "local" });
    },
    delete: (name) => raw.delete({ service: VAULT_SERVICE, name }),
  };
}

/**
 * Validate one stored session, or null.
 *
 * Every field is checked because a jar missing `frmAuth` is indistinguishable
 * from a signed-out one: restored as-is it would give a signed-in-looking
 * dashboard where every portal call fails.
 *
 * The "does this jar authenticate" test is `CookieJar.signedIn` rather than a
 * second copy of it. That fact already has one home - the jar the live server
 * uses - and a re-implementation here is how the two drift apart with no test
 * that they agree.
 *
 * An empty cookie name is refused for the same reason `absorbSetCookie` refuses
 * one: it would serialise into a `Cookie` header the portal will not explain. A
 * restored jar is held to the same rule as a live one.
 */
export function parseSession(value: unknown): StoredSession | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, at, cookies } = value as Partial<StoredSession>;
  if (typeof id !== "string" || !id) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (!Array.isArray(cookies)) return null;

  const pairs: [string, string][] = [];
  for (const pair of cookies) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [k, v] = pair as [unknown, unknown];
    if (typeof k !== "string" || typeof v !== "string" || !k) continue;
    pairs.push([k, v]);
  }
  // No `frmAuth` is not a session. Keeping one would restore a session that is
  // signed out in everything but name.
  const jar = new CookieJar();
  for (const [name, cookieValue] of pairs) jar.entries.set(name, cookieValue);
  if (!jar.signedIn) return null;
  return { id, at, cookies: pairs };
}

/**
 * The ids the index claims, or nothing.
 *
 * Never throws: the caller is a server boot, and the worst acceptable outcome for
 * an entry we cannot read is that you sign in again — which is exactly what
 * happened before any of this existed. An unparseable index yields no ids rather
 * than a guess, because an index naming sessions that cannot be read would drop
 * live ones for no stated reason.
 */
async function readIndex(backend: Secrets): Promise<string[]> {
  let raw: string | null;
  try {
    raw = await backend.get(VAULT_INDEX);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((id): id is string => typeof id === "string" && !!id);
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read the index, then the sessions it names.
 *
 * One unreadable session costs that session, not the rest: a half-understood
 * session is worse than an absent one, and one bad entry must not sign everyone
 * out.
 */
export async function loadSessions(backend: Secrets): Promise<StoredSession[]> {
  const ids = await readIndex(backend);
  if (!ids.length) return [];
  const found = await Promise.all(
    ids.map(async (id): Promise<StoredSession | null> => {
      let raw: string | null;
      try {
        raw = await backend.get(sessionKey(id));
      } catch {
        return null;
      }
      // The index and the entry can disagree - a write interrupted between the two
      // - so the id in the entry is re-checked against the key it was read from
      // rather than trusted.
      const session = parseSession(raw ? safeParse(raw) : null);
      return session && session.id === id ? session : null;
    })
  );
  return found.filter((s): s is StoredSession => s !== null);
}

/**
 * Write the sessions, so the next boot has them, then the index that names them.
 *
 * Order matters and is the reason this is not one write: sessions first, index
 * second. See the note on `VAULT_INDEX`.
 *
 * Entries for sessions that have ended are removed, so the vault does not
 * accumulate an orphan for every sign-out the user ever performed. That is a
 * courtesy rather than a correctness matter — orphans are separate entries and so
 * never count against the per-entry size cap — but a credential store that grows
 * without bound is not one anyone should be left with.
 *
 * Returns a message rather than throwing: the in-memory session is the live one
 * and the vault is only a convenience for the next boot, so a failed write is
 * logged by the caller and is never a reason to stop serving.
 */
export async function saveSessions(
  backend: Secrets,
  sessions: readonly StoredSession[]
): Promise<string | null> {
  const wanted = new Set(sessions.map((s) => s.id));
  // Read what the index names *before* replacing it. Reading afterwards would find
  // only the ids just written, and the sweep below would have nothing to remove.
  const previous = await readIndex(backend);
  // Sessions first, index second — the order is the reason this is not one write.
  // If a session write fails the old index is still in place, and every id in it
  // still resolves to a session that is on disk. The reverse order would leave an
  // index naming entries that were never written, and a load would drop live
  // sessions with nothing to show why.
  for (const session of sessions) {
    try {
      await backend.set(sessionKey(session.id), JSON.stringify(session));
    } catch (error) {
      return `could not write the session to the OS vault: ${(error as Error).message}`;
    }
  }
  try {
    await backend.set(VAULT_INDEX, JSON.stringify([...wanted]));
  } catch (error) {
    return `could not write the session index to the OS vault: ${(error as Error).message}`;
  }
  // Only now, with the new index committed, is it safe to remove what it no longer
  // names. Doing this earlier would delete a live session's entry while the old
  // index still pointed at it.
  for (const id of previous) {
    if (wanted.has(id)) continue;
    try {
      await backend.delete(sessionKey(id));
    } catch {
      // An orphan is untidy, not wrong. Never worth failing a save over.
    }
  }
  return null;
}

/**
 * Drop everything past the TTL.
 *
 * Pure, and therefore testable without a vault: a session written three weeks ago
 * by a build with a shorter TTL should be held to *this* build's TTL rather than
 * restored on trust.
 */
export function sweep(
  sessions: readonly StoredSession[],
  now: number,
  ttlMs: number
): { kept: StoredSession[]; dropped: number } {
  const kept = sessions.filter((s) => now - s.at <= ttlMs);
  return { kept, dropped: sessions.length - kept.length };
}
