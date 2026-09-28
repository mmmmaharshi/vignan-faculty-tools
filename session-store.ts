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
 * Windows Credential Manager, and `bunSecrets()` in `server.ts` is the only code
 * that does.
 */

/** One session, reduced to what a restart needs. Cookies are name/value pairs. */
export type StoredSession = {
  id: string;
  at: number;
  cookies: [string, string][];
};

/**
 * The vault operations this module needs.
 *
 * Only `get` and `set`, because a session is removed by rewriting the entry
 * rather than by deleting a key — see the one-entry note above. `Bun.secrets` does
 * have `delete`; this module deliberately does not use it, so the fake in the
 * tests cannot drift into testing something production never calls.
 */
export type Secrets = {
  get: (name: string) => Promise<string | null>;
  set: (name: string, value: string) => Promise<void>;
};

/** The service name, and the single entry inside it. */
export const VAULT_SERVICE = "ecap-attendance-app";
export const VAULT_ENTRY = "sessions";

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
  };
}

/**
 * Validate one stored session, or null.
 *
 * Every field is checked because a jar missing `frmAuth` is indistinguishable
 * from a signed-out one: restored as-is it would give a signed-in-looking
 * dashboard where every portal call fails.
 *
 * An empty cookie name is refused for the same reason `absorbSetCookie` refuses
 * one — it would serialise into a `Cookie` header the portal will not explain. A
 * restored jar is held to the same rule as a live one.
 */
export function parseOne(value: unknown): StoredSession | null {
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
  if (!pairs.some(([name]) => name === "frmAuth")) return null;
  return { id, at, cookies: pairs };
}

/**
 * Read the entry, or nothing at all.
 *
 * Never throws. The caller is a server boot, and the worst acceptable outcome
 * for an entry we cannot read is that you sign in again — which is exactly what
 * happened before any of this existed. Anything unparseable yields an empty list
 * rather than a guess, because a half-understood session is a broken one.
 */
export async function loadSessions(backend: Secrets): Promise<StoredSession[]> {
  let raw: string | null;
  try {
    raw = await backend.get(VAULT_ENTRY);
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
  // Element by element: one unreadable session costs that session, not the rest.
  const out: StoredSession[] = [];
  for (const entry of parsed) {
    const session = parseOne(entry);
    if (session) out.push(session);
  }
  return out;
}

/**
 * Write the sessions, so the next boot has them.
 *
 * Returns a message rather than throwing: the in-memory session is the live one
 * and the vault is only a convenience for the next boot, so a failed write is
 * logged by the caller and is never a reason to stop serving.
 */
export async function saveSessions(
  backend: Secrets,
  sessions: readonly StoredSession[]
): Promise<string | null> {
  try {
    await backend.set(VAULT_ENTRY, JSON.stringify(sessions));
    return null;
  } catch (error) {
    return `could not write the session to the OS vault: ${(error as Error).message}`;
  }
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
