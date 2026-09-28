# 0008 - Route to named handlers

Date: 2026-09-28

## Status

Accepted

Refines ADR 0006, which shrank the route bodies this ADR then moved. Does not
supersede it: the bands are still applied by one module in one pass.

## Context

`server.ts` had **zero exports**. Importing it to test anything booted a server
and bound `:8787`, so the file was unreachable by construction — and the
architecture review had already measured the cost: 430 of 1418 lines across
`server.ts` and `web/App.tsx`, 30%, could not be imported by any test.

ADR 0006 removed 31 lines of the `/api/register` body. What remained was
`/api/options` at 60 lines and `/api/register` at 59, both inside one `try`
inside one 236-line `fetch`.

The `/api/options` ladder is the part that mattered. It is four sequential
reads gated on progressively deeper conditions:

| asked for | reads |
|---|---|
| nothing | courses |
| course | + branches, semesters |
| course, branch, semester | + sections |
| course, branch, semester, section | + subjects |

Two of those gates were bugs waiting to happen. Drop the semester from the
sections gate and the app asks the portal for a section list for a semester the
user is not in — and the portal answers rather than refusing, so the wrong list
appears in the dropdown. Drop the section from the subjects gate and a request
goes out for a level the user has not chosen, which is the dead end ADR 0001
records the client had to be contorted to avoid.

Neither had a test, because neither could have one.

## Decision

`server-routes.ts` holds the two handlers as functions, taking a `PortalReader`.

`PortalReader` is five reads and nothing else: no sign-in, no session, no
transport. `Portal` exposes it as a `reader` property rather than by widening the
class, so the dependency the handlers declare is the small one — a handler
cannot mint a session, hold a jar, or issue a request of its own. That is what
makes it an interface rather than a parameter typed `Portal`: the live portal is
the first adapter, a test's fake is the second, and that is the test the seam
needs to be real rather than hypothetical.

What stays in `server.ts` is genuinely HTTP and stays there: reading a cookie,
parsing a body, mapping an error to a status, serving files, and the cache
header pair ADR 0004 records as a decision.

## Consequences

- **19 tests, ~950 ms, no server and no portal.** Each proven to fail by
  breaking the rule it describes: the section gate losing the semester, the
  subject gate losing the section, the semester title dropped in transit, an
  empty level thrown on rather than reported, `realOptions` skipped so
  `-Select-` becomes a choice, a label-less level accepted, and the
  empty-register 502 downgraded to a 500. Each was caught by the test naming
  that failure and by nothing else.
- **The semester title is now pinned in two places.** It was a single `?? ` in a
  route body with no test, and it is the value the client-side `optsRef` bug was
  about — a dropped title means the section list comes back from the wrong
  batch, and the register still loads, so nothing on screen shows it. Two tests
  hold it: that a title arrives, and that an *absent* title arrives as
  `undefined` rather than as `""`, which is a different thing to the caller's
  `?? semester` fallback.
- **`server.ts` is 793 → 591 lines**, and the `fetch` body is now routing. The
  404 fallthrough is still duplicated in two places; fixing that is a separate
  change and not worth mixing into this one.
- `chosenLevel` moved out of `server.ts` and became `requireLevels`, which
  validates in cascade order. The message names the level the user is looking
  for rather than an arbitrary one — "Choose a branch first" rather than
  whichever field happened to be checked first.

## Alternatives considered

**Leave it inline and add a test that boots the server.** Rejected. It would
work, and it is the wrong shape: the suite would need a free port and a
`webServer` block for a test that asserts nothing about HTTP. Worse, it makes
every future change to the ladder a slow test, which is how fast tests stop
being run.

**Inject the `Portal` class rather than an interface.** Rejected. Typing the
parameter as `Portal` would still have needed a real instance, because
`Portal`'s methods are private and it constructs its own jar. The interface is
what makes the fake possible, not a nicety.

**Extract the static-file serving too.** Rejected for now. It is 43 lines of
`Bun.file` calls that are hard to test meaningfully — the assertions would be
about Bun's file API rather than about this app's decisions. The cache header
pair is the part with a decision in it, and that is recorded in ADR 0004 rather
than moved.

**A router library.** Rejected. There are four routes. A library would add a
dependency and a layer to hide four `if` statements, which is the opposite of
what this file needs.
