# 0014 - Sessions live in the OS credential vault, and the TTL is a ceiling, not a promise

Date: 2026-09-28

## Status

Accepted

Supersedes the "sessions are still in memory" consequence recorded in ADR 0013.

## Context

The request was narrow: **stay signed in even across a server restart.**

The obvious way to satisfy it is to store the ECAP password. That was rejected
before any code was written, for a reason that turned out to be the right one
twice over: the app's central security property is that *the password is never
written to disk*, stated in `server.ts`, the README and the startup banner. There
is a way to get restart-persistence that does not touch that claim at all.

The password is used once to encrypt the login payload and is discarded. What
actually dies on a restart is the `sessions` Map, which holds ECAP's cookie jar.
So: **persist the session, not the password.** The claim stays literally true, and
now has a stronger reason than before — not "we choose not to" but "there is
nothing of yours here to leak".

## The spike, and what it changed

A file-based store was written first. Before shipping it, a spike against the
live portal asked whether ECAP's token even outlives a restart. The answer
reshaped the design, so it is recorded here in full.

**What ECAP issues at sign-in:**

```
ASP.NET_SessionId   24 chars    kh5zwcpnpzpbjdkk3pt4...
frmAuth            384 chars    EBCC23948FD5DE6BAF48...   (uppercase hex, unstructured)
```

**Neither has `Expires` or `Max-Age`.** Both are session cookies. ECAP promises
no client-side lifetime whatsoever.

**Neither authenticates alone:**

| Jar | Result |
|---|---|
| both cookies | authenticated, HTTP 200, real course list |
| `frmAuth` only | rejected, HTTP 200 with HTML — a logged-out page |
| `ASP.NET_SessionId` only | rejected, HTTP 401 |

So `frmAuth` is **not** the self-contained encrypted ticket its 384 characters
suggest. It is bound to ECAP's **in-memory ASP.NET session**. That was the
assumption the first draft of this work was built on, and the spike is what
killed it.

### The consequence, stated plainly

`SESSION_TTL_MS` is an **upper bound, never a promise.** Once ECAP's session
ends, nothing stored anywhere brings it back. A restored token whose ECAP session
has lapsed authenticates as signed-out, which is the correct and only possible
outcome.

What persistence genuinely buys is the case that was actually asked for:
**restarting our own server.** That says nothing about how long ECAP's session
lasts, and it is common — restarting mid-afternoon is not returning after a
fortnight.

ECAP's real idle timeout is not exposed over HTTP; it lives in `web.config`.
ASP.NET's default is 20 minutes, though institutions usually raise it. A
measurement is running against the live portal on a doubling ladder — 5, 15, 45,
120, 360, 720, 1440 minutes idle — because ASP.NET's expiry is **sliding**, so a
session poked every three minutes stays alive forever and a naive poller measures
nothing. Each rung therefore gets a fresh sign-in, a genuinely idle wait, and
**exactly one** check.

## Decision

### `Bun.secrets`, not a file

`Bun.secrets` is already installed — no new dependency, and it is Bun's own API
rather than a hand-rolled crypto scheme. On Windows it is Credential Manager
(`CredWriteW`/`CredReadW`, `CRED_TYPE_GENERIC`), which Microsoft ranks *above*
DPAPI in its own password-handling guidance.

It was measured on this build before being relied on, because a store that
quietly corrupts a token presents as "my session stopped working" with nothing to
look at:

- **Byte-exact round trips** for plain text, hex tokens, multi-byte characters, a
  high code unit, padded whitespace, and a 384-character token — the exact shape
  `frmAuth` has. Bun issue #24135 (a NUL after every character on Windows) does
  **not** reproduce here, and is unreachable anyway: `set()` refuses a NUL
  outright with `ERR_INVALID_ARG_VALUE`.
- `persist: "local"` is accepted at runtime and read back. It is not declared in
  `bun-types@1.4.2`; without it the entry would not outlive a reboot, which is
  the entire feature.

### What the vault does *not* do, so it is not oversold

A **separate process running as the same user reads an entry back** without
complaint. Credential Manager is not a process boundary, and neither is DPAPI —
Chromium's own OSCrypt design says the same about its own use of it.

So the threat model is **unchanged** from a file in `%LOCALAPPDATA%`: anything
already running as this user can ask. What the vault genuinely narrows is
**at-rest** exposure — backups, cloud sync, disk imaging, and other tools that
read files.

The honest summary: this is a real improvement in one dimension and no change in
another. It is not the difference between "protected" and "not protected".

### One entry, because the vault cannot be listed

`Bun.secrets` has `get`, `set` and `delete` — and **no way to enumerate**. There
is nothing to iterate at boot, which rules out one entry per session *and* the
index file that would then be needed to find them.

Everything therefore lives in a single fixed entry. The whole set is read and
rewritten together; the benefit is that **there is no index to fall out of step
with the entries it points at**, which is the failure a file-per-session design
has to be careful about and this one cannot have. Validation is still per session,
so one unreadable session costs that session and not the rest.

`delete` is deliberately unused. A session is removed by rewriting the entry, so
the `Secrets` interface the tests fake is only the surface production calls.

### Everything else

- **Restore happens before `Bun.serve`**, enforced by a top-level `await` rather
  than by a comment. `Bun.serve` begins listening the moment it is called, so a
  restore placed after it leaves a window in which a request finds an empty map
  and signs a signed-in user out.
- **Writes are debounced to 60 seconds**, flushed immediately on sign-in and
  sign-out. Sixty seconds is not a durability guess: `at` is stamped on every
  request, and rounding it to the nearest minute against a thirty-day window
  changes nothing observable.
- **A missing runtime is supported.** `bunSecrets()` returns null rather than
  throwing, and the app falls back to in-memory sessions — today's behaviour —
  instead of refusing to start. The banner says which one you got.
- **A failed write is never fatal.** The in-memory session is the live one; the
  vault is a convenience for the next boot. Losing it costs one sign-in, and
  refusing to serve a working session over that would be the worse trade.
- **A jar with no `frmAuth` is refused on restore.** It is indistinguishable from
  a signed-out one, and keeping it would produce a signed-in-looking dashboard
  where every portal call fails.
- **The TTL sweep runs after the load, not before**, so an entry written by a
  build with a shorter TTL is held to *this* build's TTL rather than trusted.

## Consequences

- **The password is still never written to disk.** Stated in three places and
  shown on every boot.
- **A restart no longer signs you out.** Proven end to end: sign in, `SIGKILL`
  the server, start it again, and the old cookie still reaches ECAP. The banner
  reads `Restored 1 signed-in session(s)`.
- **The backend is injected**, so the credential-free suite covers all of this
  over a fake and never touches the real Windows Credential Manager — the same
  arrangement `server-routes.ts` already uses with its `PortalReader`.
- **121 tests, 118 of them credential-free in about six seconds.** Eleven new, all
  proven able to fail by seven mutations.
- **The UI copy is now the weak point.** `SignInPanel` says "a session that stays
  active for up to 30 days", which is true of *our* session and silent about
  ECAP's. That is a claim to revisit once the ladder reports.

## Alternatives considered

**Store the password, encrypted.** Rejected. The app ships ECAP's own AES key in
the browser bundle, so a key the app holds is not protection — anyone who reads
the bundle reads both and recovers the password in one line. It would also invert
the app's central security claim to gain nothing the session store does not
already give.

**A plaintext JSON file.** **Built first, then replaced.** It worked and was
mutation-proven, but the vault is already installed, is byte-exact on this build,
and deletes the format-version negotiation, the atomic rename, and the
corrupt-document matrix in one move. A file also has a location to get wrong: this
checkout is under **OneDrive**, so a token file written beside the source would
have been synced to cloud storage. The vault has no such failure mode.

**Encrypt the file with a key from `ECAP_SESSION_KEY`.** Rejected — the key ends
up next to the ciphertext, which is the same objection as the browser case.

**Rely on the browser's password manager.** It does not help here: the thing that
dies is the *server's* memory, and no browser extension can write to it.

**Windows DPAPI via `bun:ffi`.** Superseded. `Bun.secrets` already wraps the
better of the two, in Bun's own API, with no FFI.

**Persist nothing and accept the restart.** Rejected: the user asked, and the cost
is ~120 lines and one OS call.
