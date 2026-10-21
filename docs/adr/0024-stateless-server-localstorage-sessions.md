# 0024 - Stateless server, localStorage sessions

Date: 2026-10-21

## Status

Accepted

## Context

The server kept every session itself: an in-memory map of portal jars keyed by
a random id, a browser cookie naming the entry, and the OS credential vault
(plus a plaintext dev file) so a restart kept users signed in. That binds the
app to one long-running process — a second instance, or a fleet of serverless
functions, cannot answer for sessions it never held. Deploying to Vercel needs
any instance to answer any request. The site also needs no vault-grade storage:
it is one faculty member's own tool, and they accepted the browser holding the
session instead.

## Decision

The server keeps nothing per user. The browser stores `{userId, password,
cookies, at}` in localStorage under `ecap-session` and sends it as the
`x-ecap-session` header on every request; every answer carries the slid session
back in the same header, and a refusal carries none. `handleApi` rebuilds the
portal jar from the request, enforces the thirty-day `at`, and revives a dead
portal session from the carried credential exactly as before. `session-store.ts`
— vault, index budget, restore-before-serve — is deleted, with its spec.

- **The ECAP password lives in localStorage in the clear.** That is the price
  of a server with no per-user state, accepted deliberately. Anyone holding the
  browser's storage holds the ECAP account with it.
- **Signing out is client-side.** The browser drops its stored session beside
  the cache sweep; `/api/logout` answers `{ok: true}` and ends nothing.
- **The retry rules are unchanged.** A 401 mid-request still signs in again
  once and retries; a second still answers; a 502 still retries nothing and
  signs out nobody (ADRs 0002, 0013, 0019).

## Consequences

- **One `handleApi` serves three runtimes.** `bun server.ts` locally, the Vite
  dev plugin, and `api/[[...path]].ts` on Vercel all call the same handler,
  which imports nothing runtime-specific.
- **A restart signs out nobody.** The session was never in the process, so
  `--watch` restarts, dev restarts and cold starts all keep the user signed in.
- **No server secrets to configure.** The Vercel deployment needs no vault, no
  KV and no environment variables — but ECAP must still be reachable from its
  network, which only a live deploy can prove.
