# 0015 - The selection does not live in the query string

Date: 2026-09-28

## Status

Accepted

Supersedes ADR 0010 and ADR 0011, both deleted. Their numbers are not reused.

## Context

ADR 0010 put the five cascade levels and the date range in the query string, so a
register could be bookmarked and sent to a colleague. ADR 0011 amended it: a link
that stops one click short of showing the thing it names is not doing its job, so
arriving at a URL with a subject in it opened the register with no click.

Together they bought a shareable link, and they cost:

- `selectionToQuery` and `queryToSelection` in `web/cascade.ts`, and a describe
  block of tests for both.
- A URL-write effect in `App.tsx` that competed with `signedOut`'s navigation for
  the history, and needed a guard to stop signing out bouncing back to a
  signed-in-looking dashboard.
- A `wantedSubject` ref, replayed after the cascade settled, because
  `applyOptions` clears the subject on every pass and a link naming one would
  otherwise land on an empty dropdown.
- A tail on the refresh loop whose only job was to fetch a register on arrival.
  That tail is what forced `fetchRegister` to take the selection as *arguments*
  rather than read it from state — the stale-closure bug ADR 0011 records, which
  arrived as "Choose a course first" on a link whose course was plainly set.
- The number in the address bar. `?course=1&semester=3&branch=6&section=1&subject=2946&from=2026-09-01&to=2026-09-28`
  is a long thing to look at, and it changed on every one of the cascade's
  auto-fills.

The user asked for it gone, at the user's request, with the trade named and
accepted rather than discovered later.

## Decision

**The selection lives in React state and nowhere else. The URL names the screen
and carries no parameters.**

- `web/cascade.ts` loses `selectionToQuery`, `queryToSelection` and `isIsoDay`.
- `App.tsx` loses `useSearchParams`, the seed it read the selection from, the
  effect that wrote it back, the `wantedSubject` ref and its replay, and the tail
  of the refresh loop that opened a register on arrival.
- `sel` starts as `EMPTY_SEL` and `range` as `defaultRange()`.
- ADR 0010 and ADR 0011 are deleted rather than marked superseded, so a reader
  cannot find them and follow them.

## What this costs, stated plainly

1. **A register cannot be shared or bookmarked.** There is no link to send a
   colleague and no address to come back to.
2. **A refresh starts over.** The cascade refills from the top and the subject is
   empty. The dates come back, because `defaultRange()` is month-to-date and is
   what the app opened with anyway.
3. **The subject is chosen by a person and never restored.** `applyOptions` still
   clears it on every pass, and now nothing puts it back. `Load register` is the
   only way a register is ever fetched, so it is a decision every time — which is
   the property the new smoke test pins.

## What this gains

- `runRefresh` does one thing: fill the cascade. Its dependency list is `[signedOut]`
  rather than `[fetchRegister, range, signedOut]`, and it no longer reaches
  `/api/register` at all.
- The URL-write effect is gone, and with it the class of bug where two effects
  competed to write history and signing out bounced.
- The address bar says where you are and nothing else.

## Consequences

- **`cascade.spec.ts` loses the `"the selection in the URL"` describe block** —
  eight tests. The suite is 128 tests, down from 136.
- **The smoke test is rewritten, not deleted.** `a link opens the register, and
  arriving by hand does not` became `the click is the only way a register is ever
  fetched`. It keeps the request-counting approach, which is the only honest way
  to assert this, and it now covers a stronger property than the old pair did:
  there is exactly one route to a register and it is the button.
- **The main smoke test asserts an absence.** The query string must be empty
  after loading a register, and a reload must leave the subject blank. Both pin
  the removal, so the feature cannot be reintroduced by accident — the same job
  the old assertions did in the other direction.
- **ADR 0009 is untouched.** The URL still names the screen, which was its whole
  subject. Dropping parameters from a route is not a reversal of it.

## Alternatives considered

**Stop writing the query string but keep reading it.** Rejected. It leaves two
live code paths for one feature, and the reading half is unreachable once nothing
writes the parameters — code that cannot be reached is code that cannot be
tested.

**Keep the write, drop only the auto-load.** That is ADR 0010 as amended by the
first half of ADR 0011: a shareable link that needs a click. It keeps the whole
effect that competes with `signedOut`, which is the most expensive part, for a
link that does not open.

**Keep the parameters off the screen but in the history.** No mechanism for this
that is not a query string.
