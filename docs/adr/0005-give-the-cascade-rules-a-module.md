# 0005 - Give the cascade's rules a module, and let the loop stay in App

Date: 2026-09-28

## Status

Accepted

Refines ADR 0001's structure. Does not supersede it: the cascade is still driven
imperatively, step for step, and is still not a reducer.

## Context

ADR 0001 ported the cascade from an imperative script to React and recorded it as
load-bearing. Its Correction notes the chain "was wrong three separate times
before it was right", and the two structural mistakes it guards against - the
chain dead-ending, and the loop spinning - are exactly the kind that survive
review, because nothing goes red. A dead-ended dropdown looks like a portal
problem. A spinner looks like a slow network.

The file also carried the reason those mistakes survived twice. The rules sat in
`web/App.tsx`, which exports one symbol and mounts React when imported, so **no
test could reach any of them**. The file that documented the traps was the file
that could not check them. The only coverage was one end-to-end smoke test, and it
exercises the boot pass alone: reaching `runRefresh`'s other branches means
driving five dropdowns in a specific order against a live portal, and the branches
that matter most are the ones where something must *not* happen.

An architecture review measured the gap. Across `server.ts` and `web/App.tsx`,
**430 of 1418 lines - 30% - could not be imported by any test.** In `App.tsx` the
unreachable part was 125 lines of pure functions plus 97 more inside the loop.

## Decision

Split the cascade's *rules* from its *loop*.

`web/cascade.ts` owns everything that is a function of data: `applyOptions`,
`chosenLevels`, `isReady`, `disabledLevels`, `shouldContinue`, `chosenText`,
`toPortalDate`, `defaultRange`, `statusOf`, `tintFor`, and the `LEVELS` vocabulary
they share. It is pure, imports only `shared/api.ts`, and touches no DOM, no
React and no globals.

`App.tsx` keeps `runRefresh`, `refreshToken`, `selRef` and `optsRef` - the part
that is about *time* rather than data: which pass wins, and how a memoised
callback sees the current selection.

The seam is the line between those, and it is the same one `portal-replies.ts`
draws for the server. ADR 0003's reasoning transfers unchanged: a rule that is a
pure function over plain data can be tested in milliseconds, and a rule that is
not has to be tested through a browser and a live portal.

## What moved, and what did not

`shouldContinue` is the loop's decision, extracted as a function rather than left
inline. That is the one piece of the loop that was not, and the extraction is the
point: the predicate is now testable on its own, and the loop body is four lines
longer than "ask the rules".

`disabledLevels` is new. The five booleans were hand-written in `App` and now
derive from the same condition the server's ladder uses. Two hand-maintained
copies of one dependency rule is how they drift.

## Correction to a comment, not to ADR 0001

The commit that split the presentational components left this in `App.tsx`:

> It owns the cascade outright - `runRefresh` and the ref pattern stay here, not
> in a child, because that logic is load-bearing and a reader debugging the chain
> should find it in one place.

That was written two commits before this ADR and it is now wrong in its
particulars. The concern behind it - a reader should not have to hunt - is
sound and is kept, but it is answered by naming which file answers which question
rather than by keeping everything in one. A reader debugging *why a dropdown is
empty* reads `cascade.ts`. A reader debugging *why two requests raced* reads
`App.tsx`.

The "not a reducer" constraint from ADR 0001 is untouched. There is no new state
shape, no dispatch, and the same order of operations.

## Consequences

- **21 tests, under a second, no portal and no browser.** Each was proven to fail
  by breaking the rule it describes: auto-selecting the subject, forcing
  `gained` false, making the loop unconditional, resetting a still-valid choice,
  keeping a dead value for an empty level, and reverting the date fix. Each
  mutation was caught by the test that names that failure, and by nothing else -
  which is the standard the existing seam tests were held to.
- **`tsconfig.test.json` gained one line**, `web/cascade.ts`. Listed file by file
  rather than as `web`, because `web/` is the DOM+React project and the test
  harness is not. That the same file compiles in both projects is a property of
  it being free of both, and it was verified by probe rather than assumed.
- **A real bug surfaced immediately.** `defaultRange` built its range with
  `toISOString()`, which converts local midnight to UTC - so east of Greenwich the
  app opened one day early, at the wrong end of the range, for every reader in
  IST, and it was invisible until the function had a test. It now builds from
  local date parts, and tests hold it: the 1st-of-the-month case, where the
  conversion costs a day of the range, and a single-digit month that would not
  have been accepted by a date input.
- `web/components/rowStyle.ts` is deleted and `web/types.ts` is reduced to one
  type. See the architecture review's candidate 5: both failed the deletion test,
  and this was the moment to notice.
- `App.tsx` is 571 -> 424 lines, and the part of it that is a rule rather than
  orchestration has gone to zero.

## Alternatives considered

**A context provider for the cascade state.** Rejected. One consumer, nothing to
swap the state implementation for, and a provider would obscure the flow in code
that has already shipped a stale-closure bug. The rules do not need to be shared;
they need to be reachable.

**Move `runRefresh` into a hook.** This is the one that would have been a
reduction in clarity. The ref pattern is the subtle part - `selRef` and `optsRef`
are written during render precisely because `runRefresh` is memoised with `[]`,
and the bug that motivated `optsRef` shipped silently. A hook would spread that
across two files and make the closure easier to get wrong, in exchange for
nothing the module does not already give.

**A reducer.** Already rejected in ADR 0001 on sequencing grounds, and that
reasoning is unaffected. `shouldContinue` needs the previous pass's selection to
decide whether to continue, which a reducer over (selection, reply) state does
not express without threading extra state through - and the loop's interaction
with in-flight requests is the part most worth keeping explicit.

**Leave it, and rely on the smoke test.** Rejected because the branches that
matter are unreachable that way. The test would have to click through the app to
provoke a dead end, and a test that provokes a bug by clicking is a test that
breaks whenever the UI moves.
