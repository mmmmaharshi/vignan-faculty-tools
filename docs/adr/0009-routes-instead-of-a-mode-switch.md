# 0009 - Routes instead of a mode switch

Date: 2026-09-28

## Status

Accepted

Refines ADR 0001's structure and builds on the `signedOut` commit, 7672e49. The
cascade is untouched.

*Later amendment.* ADR 0010 and ADR 0011, which put the selection in the query
string, have both been deleted; see ADR 0015. Nothing in this decision depended
on them — the URL naming the *screen* is what ADR 0009 is about, and that still
holds. Dropping the query parameters from a route is not a reversal of it.

## Context

The app had a `phase: "boot" | "login" | "app"` state variable and rendered
three ways off it, with `setPhase` at four call sites. Every one of them was a
fact about the app that lived in one component and could not be reached from
anywhere else — the URL said `/` in all three cases.

That is usually fine for an app with one screen. It stopped being fine here for
two reasons that arrived together:

- **Ending a session was invisible.** A 401 did `setPhase("login")`, which
  changed the screen and nothing else. The old session's selection, options,
  register and filter stayed in state, so signing back in produced a table
  already narrowed by a choice made against a session that no longer existed.
  Fixing that meant a `signedOut()` that clears everything — and a `setPhase`
  call in three places is exactly the kind of thing that drifts apart.
- **The back button left the app.** A refresh re-asked the server and re-ran the
  decision, which is fine until a session has ended: the user comes back to
  numbers that are no longer anyone's.

A mode variable cannot express either. A route can.

## Decision

Add `react-router` and let the URL answer "which screen".

- `/` is the dashboard, `/login` is the sign-in form, anything else redirects to
  `/`.

  **Amended three times.** First, the dashboard moved to `/dashboard`, at the
  user's request, with `/` kept as a way in so an old bookmark and a typed address
  do not break. The structure was unchanged — still two screens, still `App`
  owning both.

  What that cost was a lesson worth recording: the `<Route>` list in
  `web/main.tsx` and `DASHBOARD_PATH` in `web/App.tsx` were two statements of the
  same fact, with nothing that would notice them disagreeing. When only one was
  updated the catch-all redirected `/dashboard` to `/`, the guard redirected `/`
  back, and the two took turns for ever. It looks like a slow page, not an error.

  Then the lesson was applied. The list is now a **single catch-all** rendering
  `App`, because every route in it rendered the same component and therefore
  carried no behaviour. A path that only names `App` has no business in
  `main.tsx`, and with one route there is no second statement left to drift. The
  redirect loop is now impossible by construction rather than prevented by
  vigilance — the difference between a rule and a comment.
- `App` still decides what each path means, and still owns all the state. The
  router is not asked to split the component, because splitting it would either
  duplicate the cascade's state or move it into a context — and ADR 0005 already
  rejected a context on the grounds that it would obscure the flow in code that
  has shipped a stale-closure bug.
- `phase` and every `setPhase` are gone. `navigate` replaces them, and
  `signedOut` navigates with `replace: true` so the back button cannot walk into
  a session that has ended.
- The `boot` state survives as a `booted` flag, but it is no longer a screen: it
  means "have we asked `/api/session` yet", and the header renders alone until
  they have. Without it, deep-linking to `/` while signed out flashes the whole
  cascade before the guard redirects.

### The server had to change too

Client-side routes are not files, so `/login` 404'd before any JavaScript ran.
`server.ts` now serves `index.html` for any non-`/api` GET whose path has no dot
in it. A path *with* a dot is a real request for a file — a missing hash in a
built bundle — and still answers 404, because returning HTML for it would turn a
clear 404 here into a confusing parse error in the browser. The `no-store` header
on `index.html` is unchanged and is the right one: it is the document that points
at the hashed assets.

`indexHtml()` is a function now rather than an inline block, because three paths
serve it.

## The guard has two halves, and the second was missing

The first version checked the session once, on mount. That handles deep links —
`/` while signed out goes to `/login` — and it is what a browser test on a cold
load would exercise.

It did nothing about **client-side** navigation. Verified in a real browser: sign
in, reload, press Back, and the signed-in user was shown the login form. The
guard had already run, `booted` was true, and nothing looked at the route again.

So there is a second effect, small and separate: a signed-in user who lands on
`/login` — by Back, by a stale bookmark, by typing the path — is sent to `/`. It
depends on a `signedIn` state that the boot check, `signIn` and `signedOut` all
set, because the URL alone cannot tell "not signed in" from "signed in, wrong
screen". This is the mirror image of the bug the session probe fixes: that one
catches a session going stale, this one catches the screen going stale.

## Consequences

- **`phase` is gone**, along with its four call sites and the union type. `booted`
  and `signedIn` remain, and both are about a fact the URL cannot carry.
- **A second adapter-free dependency.** `react-router` is the first runtime
  dependency beyond Mantine and React. It is 8.4.0, and `Routes`/`Route`/
  `BrowserRouter`/`useLocation`/`useNavigate` are all used. `Navigate` no longer
  is — see the amendment above, where the catch-all stopped redirecting because
  `App` was already deciding where every path goes.
- **The server serves `index.html` for extensionless paths.** Verified: `/`,
  `/index.html`, `/login`, `/dashboard` and `/nonsense/deep/path` all return 200
  HTML; `/assets/does-not-exist.js` returns 404 JSON; `/api/nope` returns 401; and
  `/favicon.ico` is still 204.
- **Assertions added to the smoke test**, all of which fail if the router is
  removed: a deep link to the dashboard lands on `/login`, signing in navigates to
  `/dashboard`, and a reload stays there with the cascade populated. The first is
  asserted in `submitSignIn`, so every test that signs in checks the guard. A
  fourth watches the wire while signed in and fails if any path keeps making
  requests after settling — the redirect loop presents as a page that merely never
  finishes loading, so it is counted rather than looked at.
- **Back after sign-out leaves the app.** `signedOut` replaces rather than pushes,
  so the dashboard entry is gone. That is deliberate — a history entry pointing at
  a screen the user no longer has access to is worse than a dead end — and the
  guard makes the alternative harmless if it ever changes: Back onto `/` bounces
  to `/login` rather than showing a stale cascade.

## Alternatives considered

**Put the five levels and the date range in the query string**, so a register is
bookmarkable and survives a refresh. This is the obvious next step and the reason
to have a router at all, but it is a feature rather than a refactor: it needs a
decision about whether a bad query string shows an error or falls back, and it
changes what "Load register" means. Deliberately not bundled here. Asked about
and declined in favour of replacing the mode switch alone.

**Two routed components, one per screen.** Rejected. It splits the cascade's
state across a route boundary, and the only ways to avoid that are duplicating the
state or putting it in a context. Both are worse than one component with a `pathname`
check.

**`HashRouter`.** Rejected. It would have avoided the `server.ts` change, at the
cost of `#/login` in the address bar. The server change is nine lines and the
cleaner URLs are worth more than avoiding them.

**Keep `phase` and just add a `signedOut`.** Rejected. That fixes the state leak
and leaves the back button broken, which is the other half of the reason for
this.
