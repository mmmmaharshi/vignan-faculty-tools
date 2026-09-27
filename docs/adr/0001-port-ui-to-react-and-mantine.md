# 0001 - Port the front end to React and Mantine

Date: 2026-09-27

## Status

Accepted

## Context

The dashboard was a local, read-only Bun server plus three hand-written front-end
files: `public/index.html` with an inline stylesheet, and `public/app.js` with
imperative DOM code. It had zero dependencies, no build step, and started with
`bun server.js`.

It worked. The five-level cascade rendered, a 63-student register came back
worst-first about three seconds after a cold sign-in, and CSV export worked. The
stated reason for the port was that the UI looks plain.

Two things were genuinely awkward about the hand-rolled version, and both are
free with Mantine: accessibility semantics were whatever the markup happened to
say, and dark mode would have to be written by hand.

## Decision

Replace the front end with React 19 and Mantine 9, built by Vite 8. Adopt the
Mantine design system as the only source of visual style.

Four decisions were taken explicitly, and each one cost something:

1. **Accept a build step.** JSX has to be transformed, so zero-install is gone.
   Vite emits `dist/`; `bun server.js` keeps serving it, so production is still a
   single process. No dev-server proxy was added, because a second concurrent
   origin is exactly the kind of race this project has already been bitten by.
2. **Drop the Print button and the print stylesheet.** Mantine ships no print
   stylesheet, and "no custom style" was taken literally. A printed register now
   comes out as whatever the browser does with Mantine's `Paper` and `Badge`
   tokens. This is a real feature removal, accepted knowingly. Restoring it later
   is a small `@media print` block, not a rewrite.
3. **Port the cascade logic step for step.** The dependency chain, the auto-advance
   rule, the stale-response guard and the signed-out check were all wrong at least
   once during the original build. They are ported in the same order with the same
   guards, unidiomatic as that looks, rather than rewritten as a reducer. A
   rewrite during a framework change is how the race comes back.
4. **Mantine components only for the UI.** No bespoke CSS. The one concession
   would have been print styling, which decision 2 removed.

## Correction, after review

A two-axis review of the port found that decision 3 was recorded inaccurately,
and that the original rule it describes could not actually work.

The old rule was "auto-choose only when a level has exactly one option, otherwise
stop and let the user pick". Porting it faithfully produced a dead end: a
single-option level cannot be changed, so nothing below it was ever fetched, and
the subject list became unreachable. The fix was to let **every** level above the
subject auto-fill to its first option, so the chain populates itself and the user
overrides what they disagree with. The subject stays unchosen by design.

That is now the recorded behaviour, in `AGENTS.md` and in the front end. The text
of decision 3 above is left as originally written so the change is visible.

## Consequences

- `bun install` is now required. `node_modules` is a few hundred megabytes.
- Running the app means `bun run build && bun server.js`.
- The front end is now three source files under `web/` compiled into `dist/`,
  which `server.js` serves. `public/` goes away.
- Print output is no longer a supported use of the app.
- Accessibility and dark mode improve without bespoke work.
- The subtle cascade logic is unchanged in behaviour but is now expressed as
  effects, where stale-closure and effect-ordering mistakes replace the
  double-request mistakes it had before. It still needs a real browser to verify.

## Alternatives considered

- **Leave it alone.** The app works and has no dependencies. Rejected because
  accessibility and dark mode are real gaps and the owner wants the visual change.
- **Adopt a component library without React.** Preact or a no-JSX approach would
  have kept the bundle small, but Mantine is React-only, so the choice was React
  or nothing.
- **Keep the dev server with a proxy.** Rejected: two origins in front of a
  project whose worst bug was already a concurrency race.
- **Rewrite the cascade as a reducer.** Rejected on the grounds of sequencing,
  not aesthetics.
