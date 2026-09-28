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

ECAP's real idle timeout is not exposed over HTTP; it lives in `web.config`. It was
measured against the live portal on a doubling ladder — 5, 15, 45, 120, 360, 720,
1440 minutes idle — because ASP.NET's expiry is **sliding**, so a session poked
every three minutes stays alive forever and a naive poller measures nothing. Each
rung therefore got a fresh sign-in, a genuinely idle wait, and **exactly one**
check.

**The result: ECAP's idle session is between 15 and 45 minutes.** Alive at 15, dead
at 45.

So the practical ceiling on any session here is ECAP's, not ours, and it is
**short**. Three consequences, stated rather than smoothed over:

- The 30-day TTL is a ceiling nothing will reach. The app's own window is long
  enough to cover a coffee break and little else, so what the persistence actually
  buys is **surviving our own restart**, which is the case that was asked for and
  the one that is genuinely common.
- A sign-in that is idle for half an hour needs re-authenticating. That is ECAP's
  behaviour, not ours, and no amount of local storage changes it.
- The sign-in form's "up to 30 days" line was removed rather than restated. A
  truthful replacement would have to name ECAP's timeout, which we do not control
  and cannot promise to keep true.

## Decision

The evidence for the choice below — the primary sources, the comparison table, and
why each rejected option was rejected — is in
[`docs/research/credential-storage.md`](../research/credential-storage.md). It is
the record of what was investigated; this is the record of what was decided.

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

### One entry per session, plus an index — and the size cap that forces it

`Bun.secrets` has `get`, `set` and `delete` — and **no way to enumerate**, so
something has to record which entries exist. That is `VAULT_INDEX`, a list of ids.

The obvious alternative is everything in one entry, and it is what this ADR
originally decided. **It does not work.** On Windows a generic credential's blob
is capped at `CRED_MAX_CREDENTIAL_BLOB_SIZE` = 5 × 512 = **2560 bytes**, and a
session is ~526 bytes of JSON once the portal's 384-character `frmAuth` is in it.
Measured on this build:

```
 1 session  =  526 bytes  OK
 4 sessions = 2101 bytes  OK
 5 sessions = 2626 bytes  REJECTED: The stub received bad data. (code: 1783)
```

That is the worst shape of failure. `saveSessions` reports a problem rather than
throwing, the server logs it and carries on serving, and **persistence simply
stops working after the fifth sign-in** — with nothing on screen to say so. The
first version of this design had exactly that bug. It was found only by accident:
a test run had left four stale sessions in the vault, and the fifth write was
rejected. Nothing in the code would have told us, and no test would have failed.

One entry per session puts each comfortably under the cap and leaves the index
holding only ids at ~39 bytes each, so the cap is not reached until roughly sixty
sessions — not a real limit for a single-user local app.

**Write order is load-bearing.** Sessions first, index second, orphan sweep third.
A failure part-way then leaves an index naming only entries that are actually
stored; the reverse order would leave an index pointing at nothing, and a load
would drop live sessions. An entry is also re-checked against the key it was read
from, so one filed under the wrong id cannot restore as a session whose id the
cookie does not match. `delete` is used after all, to remove entries for sessions
that have ended, so the store does not grow without bound.

### Everything else

- **Restore happens before `Bun.serve`**, enforced by a top-level `await` rather
  than by a comment. `Bun.serve` begins listening the moment it is called, so a
  restore placed after it leaves a window in which a request finds an empty map
  and signs a signed-in user out.
- **Writes are debounced to 60 seconds**, flushed immediately on sign-in **and
  sign-out**. Sixty seconds is not a durability guess: `at` is stamped on every
  request, and persisting it to the nearest minute against a thirty-day window
  changes nothing observable.
  The two immediate flushes are the exception that proves the rule, and **the
  sign-out one was originally missed.** It marked the store dirty and returned, so
  sign out, hard-kill the server, start it again, and the session was still there
  — the user ended it and it came back. The signal handlers do not help; they
  cover a graceful Ctrl-C, not Task Manager or a power cut. `dropSession` now owns
  the delete-and-dirty pair so the two cannot be separated again.
- **The browser cookie is re-issued on every authenticated response.** The server's
  session slides on use; a cookie written once at sign-in does not, so a user who
  opened the app every day was signed out on day thirty-one anyway — the feature
  failing for exactly the person it was built for, while this ADR claimed the
  cookie was derived from the TTL so the two could not disagree. `Max-Age` only
  means *thirty days from your last use* if something re-issues it, and the
  browser has no other way to know the app is in use.
- **A missing runtime is supported.** `bunSecrets()` returns null rather than
  throwing, and the app falls back to in-memory sessions — today's behaviour —
  instead of refusing to start. The banner says which one you got.
- **A failed write is never fatal.** The in-memory session is the live one; the
  vault is a convenience for the next boot. Losing it costs one sign-in, and
  refusing to serve a working session over that would be the worse trade.
- **An empty course list means the session is dead, not that the portal broke.**
  A signed-out request to convention A answers **200 with valid JSON** whose
  `<select>` holds only `-Select-`. Every sign of life looks good, which is why
  this was missed. Do not "simplify" the check in `handleOptions` or the
  `/api/session` probe back to looking only for a 401.
- **A jar with no `frmAuth` is refused on restore.** It is indistinguishable from
  a signed-out one, and keeping it would produce a signed-in-looking dashboard
  where every portal call fails.
- **The TTL sweep runs after the load, not before**, so an entry written by a
  build with a shorter TTL is held to *this* build's TTL rather than trusted.

### A dead session is answered 200 with an empty list

Measured, and it is the third failure mode, not the second.

| How a dead session arrives | Shape |
|---|---|
| convention B (`#webMethod`) | 401 — the reply is HTML and is caught |
| convention A, occasionally | 502 — unreadable, and genuinely ambiguous |
| **convention A, usually** | **200, valid JSON, `<select>` holding only `-Select-`** |

The third is the one that matters and the one this ADR originally got wrong. Every
sign of life looks good: the status is 200, the payload parses, the shape is
right. Only the contents are gone. And "the courses came back empty" is precisely
what `emptyLevels` was built to interpret as *"ECAP's layout has changed"* — so an
expired session was reported as a broken portal, with a signed-in dashboard and
five dead dropdowns behind the message. That is the one reading that is certainly
wrong, and the app chose it.

Every account has at least one course, so **an empty course list can only mean the
session is gone.** **The decision now lives in one place**, `portal-liveness.ts`, answering
`alive | dead | unknown` from that evidence. Both callers ask it — `handleOptions`
and the `/api/session` probe — so the rule cannot drift between two layers. It was
originally written twice, and the copy with no test coverage was the one that
shipped the bug, which is the whole argument for a module with an interface a test
can cross rather than a check inlined in a handler.

`handleOptions` throws **401** on `dead`; the probe **evicts** on `dead`. A 502 is
`unknown` and neither caller acts on it. That case really is ambiguous, and ADR
0002's refusal to turn uncertainty into a lost session still stands.

One wrinkle worth recording, because the first version got it wrong and a mutation
probe caught it: a caller that needs both the verdict and the options must ask for
them together via `courseVerdict`, not read `portal.courses()` itself and hand the
result to `liveness`. Reading first lets a throw escape *before* the rule is
reached, so the 502 refusal held by accident rather than by decision.

Measured boundary: a session 19 minutes old returns the real course, one 22
minutes old returns the empty select. That is ECAP's own timeout, not ours.

### Sessions are pruned on every write, not only at boot

A boot-time sweep was not enough. A long-running server does not boot again, and
every sign-in from another browser added an entry — **seventeen after half an hour
of test runs, seven of them already dead at the portal.** With one entry per
session that also spends the 2560-byte cap.

The cutoff is a day, which is far more than ECAP needs and far less than the TTL:
the portal's session ends at about twenty minutes, so anything older could not
authenticate whatever we did with it. It is generous on purpose — deleting a
session that would still have worked is the worse failure.

## Consequences

- **The password is still never written to disk.** Stated in three places and
  shown on every boot.
- **An expired session no longer looks signed-in.** The symptom the user hit was a
  dashboard with dead dropdowns and a warning blaming ECAP's layout; it is now a
  sign-in form with a reason. Verified end to end with a real 24-minute wait, not
  only against a fixture.
- **A restart no longer signs you out.** Proven end to end: sign in, `SIGKILL`
  the server, start it again, and the old cookie still reaches ECAP. The banner
  reads `Restored 1 signed-in session(s)`.
- **The backend is injected**, so the credential-free suite covers all of this
  over a fake and never touches the real Windows Credential Manager — the same
  arrangement `server-routes.ts` already uses with its `PortalReader`.
- **130 tests, 124 of them runnable without credentials in about six seconds.**
  Six are smoke tests and skip without them. Every session-store test is proven
  able to fail: the one-entry shape, a truncated index, a mismatched id, the
  orphan sweep, the write order, and the two immediate flushes each turn a named
  test red when broken.
- **One smoke test reads the real vault, read-only.** "A sign-out is persisted" is
  a claim about a write reaching disk, and the only honest way to see that is to
  look. Asserting it from the server's side would prove nothing — a session
  removed from the map and never written still reads as signed-out. An earlier
  version of `session-store.spec.ts` made exactly that mistake and would have gone
  green with the flush deleted.
- **The UI copy no longer claims a session length at all.** It did once, and the
  number was the one thing on screen this app could not back.

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
