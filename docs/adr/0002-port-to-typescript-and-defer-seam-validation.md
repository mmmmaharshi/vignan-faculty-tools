# 0002 - Port to TypeScript, defer validation at the portal seam

Date: 2026-09-27

## Status

Accepted

## Context

The app is about 1,460 lines of JavaScript. Two facts pull in opposite
directions.

Mantine 9 is fully typed, so the front end gets real value from types the moment
they exist: the 5-level cascade in `web/App.jsx` is driven by refs and a
`refreshToken` counter, and a class of bug already shipped from it — reading
`event.currentTarget` inside a `setState` updater — is exactly what a compiler
catches and an editor does not.

Against that, `CODING_STANDARDS.md` says YAGNI, says to lean on dependencies
already in the project, and is binding. TypeScript is a new dependency and a new
thing to learn — and specifically **TypeScript 7**, the native port, not the 5.x
line most projects mean by "add TypeScript". It was adopted at 7.0.2. That is a
new major version of a compiler, not a version bump, and the configs here were
written against it rather than migrated onto it.

What settled it was looking at where the untyped data actually enters. Everything
in `server.js` that crosses the portal boundary funnels through four functions:
`options()`, `parseRegister()`, `unquoteJs()` and the `json.d` access. Three of
the four already return precisely-shaped values, and two of those are pure
`string → Shape` transformers whose outputs are guaranteed by their own logic no
matter what arrives. The seam is far smaller than the file's reputation
suggested, which is what made an honest port possible without doing the
validation work at the same time.

## Decision

Port the whole codebase to TypeScript. Five decisions, each costing something:

1. **Port everything** — `web/`, `server.js`, the smoke test and both configs.
   Not just the app.
2. **One shared types module** for the three API response shapes
   (`/api/session`, `/api/options`, `/api/register`), imported by both the server
   and the client, so renaming a field breaks the build on both sides instead of
   producing `undefined` in a table cell. It is environment-neutral: it may
   reference neither DOM nor Node globals, because it compiles in both.
3. **Split the tsconfigs by environment.** A base config plus `web` (DOM),
   `server` (deliberately *no* DOM) and `test` (DOM + Node). Excluding `dom` from
   the server project is the point: otherwise `server.ts` can call
   `document.querySelector` and the compiler will allow it, which is the class of
   bug that moved all portal access out of the browser in the first place. One
   DOM-enabled config for everything would quietly give up half of what the
   shared module buys.
4. **Type the seam functions' outputs truthfully and leave their inputs `any`.**
   `json.d` genuinely is unknown — `unknown` there would be theatre and `any` is
   accurate. The one dishonest spot is `unquoteJs()`, which today infers its
   return type as `any` because one branch returns `JSON.parse` output directly,
   while callers assume `string`. Declaring it and narrowing that branch is the
   honest fix; a cast over the whole function would not be.
5. **`strict` plus `noUncheckedIndexedAccess`.** The second flag types `arr[i]` as
   `T | undefined`, which turns "the portal sent a shorter row than expected"
   into a type error rather than an `undefined` rendered into a table. The
   parsing code already writes `?? ""` at exactly these sites, so the flag mostly
   makes existing intent enforced rather than adding new work.

## Consequences

- **`tsc` is advisory, not a gate.** Vite and Playwright both use esbuild, which
  strips types without reading them. Nothing runs the type checker
  automatically; the editor is the only enforcement, and `bun run build` passing
  says nothing about types. This is the weakest part of the decision and is
  recorded as such rather than discovered later.
- `bun server.js` becomes `bun server.ts`. Bun runs TypeScript natively, so no
  build step is added on the server side; the front end's Vite build is unchanged
  in shape.
- The deferred seam validation now has somewhere to land. It is no longer "add
  types to an untyped file" but "narrow one branch in `unquoteJs` and replace
  the unverified `json.d` hop with a guard", at known lines.
- A field renamed on the server without the client changing is now a build
  error. Before this port it was a blank cell.
- This port reverses `CODING_STANDARDS.md` on YAGNI and on leaning on existing
  dependencies, deliberately. It wins because Mantine 9's types are the front
  end's largest source of complexity, and because the shared module turns the
  server/client contract into something the compiler checks rather than
  something the two halves agree about by memory. Rule 9 also says not to assume
  a library lacks a capability without checking its types — checking them is what
  surfaced the gap.

## Alternatives considered

- **Type the front end only.** Cheapest, and roughly what ADR 0001's port
  implied. Rejected: the client cannot be honestly `strict` while the server's
  three responses are `any`, and an untyped boundary is exactly where a wrong
  shape does damage.
- **Label the portal shapes with `as` and call the file typed.** Rejected: a cast
  is a label, not a check. It makes `tsc` pass while proving nothing, which is
  worse than `any` because it reads as rigorous.
- **Validate the portal seam now, in the same pass.** This is the deferral.
  Rejected because it is a different job with a different risk profile: it adds
  guards that need their own tests, and `CODING_STANDARDS.md:12` is right that an
  untested guard is close to decoration. It gets its own ADR and its own tickets
  rather than riding along as an unremarked extra.
- **Leave it as JavaScript.** Rejected: the app is small and stable, but the
  front end leans on a fully-typed component library, and the integration most
  likely to break is the one carrying no types at all.
- **One `tsconfig.json` for the whole repo.** Rejected; see decision 3.
