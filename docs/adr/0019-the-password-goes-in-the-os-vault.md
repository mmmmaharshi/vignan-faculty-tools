# 0019 - The password goes in the OS vault, so a dead ECAP session re-signs in

Date: 2026-10-15

## Status

Accepted

Supersedes the "the password is never written to disk" consequence of ADR 0014.
ADR 0014's vault mechanics (one entry per session, the index budget, the write
order) still hold and are reused here; only the claim about the password changes.

## Context

The request: **stop logging me out.** ECAP drops an idle session after roughly
twenty minutes (measured between 15 and 45; ADR 0014), and both of its cookies
are session cookies bound to ECAP's in-memory ASP.NET session. Nothing stored
locally can revive that session — once ECAP forgets you, `frmAuth` alone is
rejected. The only way to come back is to **sign in again**, which needs the
credential.

ADR 0014 chose to keep the session and not the password, which is why the app
survives its own restart but not ECAP's timeout. That was the right call for the
request it answered ("stay signed in across a restart"); it does not answer this
one.

The reference the user pointed at (`attendancetracker-six.vercel.app`) "never
logs out" because it never stays signed in: it keeps `frnd_redgNo` and
`frnd_password` in **plaintext `localStorage`** and re-sends them to its backend
on every fetch, which signs in to ECAP fresh each time. The password also travels
in a **URL query string**. It proves the pattern and shows the two ways not to
implement it.

## Decision

Store the credential (user name and password) in the **OS credential vault**
(`Bun.secrets`, the same vault ADR 0014 already uses for the session), and when
the portal reports the session dead, sign in again and retry — transparently.

- `handleApi` keeps the password on the `Session` and persists it with the
  session, so it survives our restart exactly as the session does.
- When the portal is `dead` — the `/api/session` probe, or a `401` surfacing
  mid-request — the app calls `reauthenticate`: a fresh `Portal`, a fresh
  `signIn`, then **one** retry of the original call. Not a loop.
- A `502` is still `unknown` and still retried nowhere: ambiguity must never
  sign anyone out (ADR 0013), and it must not re-send the password either.
- A stored session with no credential (migrated from before this ADR) behaves as
  before: dead means signed out.

## Consequences

**The central security property is retired.** This app no longer writes no
password; it writes the ECAP password to the OS credential vault. The README,
`CONTEXT.md` and the profile panel are updated to say so plainly. The password
still never reaches the browser, is still never logged and is still never
returned by an endpoint, but "there is nothing of yours to leak" is no longer
true and must not be repeated.

**What the vault does and does not buy.** It narrows *at-rest* exposure —
backups, cloud sync, disk imaging — via Windows Credential Manager (DPAPI) /
Keychain / libsecret. It is **not** a process boundary: any process running as
the same user can read it back (recorded in ADR 0014 and in
`docs/research/credential-storage.md`). Do not describe it as protecting against
a compromised machine.

**Dev writes plaintext.** With no `Bun.secrets` (Vite's Node runtime), the vault
falls back to `.dev-sessions.json`, which is gitignored but plaintext and, in
this checkout, sits under a OneDrive-synced directory. That store is dev-only;
it must never be used where `Bun.secrets` exists. See the `shortcut:` note in
`session-store.ts`.

**One retry, once.** Reviving happens at most once per request. A password that
has genuinely been changed or revoked will fail the sign-in, and that failure is
reported (and evicts) rather than retried.

## Alternatives considered

- **Keep-alive ping.** Poke the portal every few minutes so ECAP's sliding
  timeout never fires. Cheap and stores nothing, but it only holds while the
  request loop is running: close the browser, or leave the machine past the
  timeout, and you are signed out again. It postpones the problem instead of
  solving it, so it was not adopted on its own.
- **Browser password manager / `autocomplete`.** Already present on the sign-in
  form (`autocomplete="username"` / `"current-password"`). It saves the human
  typing, but it cannot drive the server process and does not keep the server
  session alive. Complementary, not a solution.
- **Encrypt the password with an app key.** Rejected in ADR 0014 and still
  rejected: the AES key ships in the browser bundle, so a key this app holds is
  not protection. Storing in the **OS** vault is a different thing and is what
  this ADR chooses.
