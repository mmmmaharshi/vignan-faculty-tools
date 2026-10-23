# ADR 0026 — Installable shell; service worker caches no API

## Status
Accepted.

## Context
Faculty open this on phones, where an installed app earns its home-screen
place. Chrome's install prompt needs a manifest, 192 + 512 icons, and a
service worker with a fetch handler, over HTTPS — Vercel gives the last one.
But every number on screen is a live ECAP answer bound to a session, so the
usual offline-first treatment would serve stale attendance or, worse, a cached
reply from another read's session.

## Decision
The app is installable and the shell loads fast; nothing else is promised
offline. The worker (`web/public/sw.js`, hand-rolled — a Workbox dependency
for three rules would be the tail wagging the dog, and `vite-plugin-pwa`
targets stock Vite, not this repo's `vite-plus` fork):
- `/api/*` is never intercepted: always the network, never the cache.
- `/assets/*` is cache-first: hashed filenames make that safe.
- navigations are network-first with a cache fallback.
- registration runs only in production builds, so dev never serves
  yesterday's bundle while the source moves on.

The three icons are rasterized from one SVG tile by a throwaway Playwright
script (kept out of the repo); `server/server.ts` names the manifest MIME
type explicitly rather than trusting the runtime's table.

## Consequences
- `test/pwa.spec.ts` pins the contract without credentials: the manifest
  states every install field with served icons, the worker takes the page,
  and no `/api/*` entry sits in any cache after the boot read.
- No offline page and no push: deliberately skipped (see above). Say so here
  if that ever changes, rather than discovering it from a blank screen.
