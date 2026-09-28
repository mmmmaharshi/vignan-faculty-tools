# 0011 - A link opens the register

Date: 2026-09-28

## Status

Accepted

Amends ADR 0010, which recorded "loading stays a click" as the one close call
and left it as a decision to revisit. This is the revisiting.

## Context

ADR 0010 made a register shareable, and then declined to open it:

> The link restores the selection and the dates; it does not spend a portal round
> trip on every page open, and `Load register` keeps meaning something.

The reasoning was: a round trip on every page open, an error on screen before the
user has done anything, and a button that stops being a decision.

All three are true, and all three weigh less than the feature. A shared link
that needs a click before it shows anything is a link that has not quite been
sent — a colleague opens it, sees the right subject and dates, and is then asked
to do the thing the link was supposed to do. And the round trip only happens
when the URL names a register, which is the rare case anyway.

## Decision

**A link opens the register. A click is not doubled.**

Concretely: when the cascade settles with a subject chosen, the register is
fetched. No flag, no second concept — the condition is the subject itself.

## Why there is no flag

The first version carried an `openOnArrival` ref, set when the URL named a
subject, on the reasoning that arriving from a link should open and arriving by
hand should not.

A mutation check said otherwise. Two deliberate changes to that ref — setting it
always, and clearing it after the call rather than before — **both left the suite
green.** The ref was unobservable in either direction.

It is unobservable because `draft.subject` is already the whole condition:
`applyOptions` clears the subject on every pass, and nothing except the URL seed
ever sets it. Picking a subject from a dropdown does not call `runRefresh`, so a
user choosing one never reaches the tail of the loop with a subject set. The ref
was restating something the cascade already guarantees.

It is deleted. A guard that cannot fail is not a guard, and the comment now says
what actually holds the line — which is more useful to the next reader than the
flag was.

## Two real bugs the test found

The test asserts by **counting `/api/register` requests**, because the thing
under test is whether a portal round trip happens; a table that happens to be on
screen cannot tell one request from two.

**1. `signedIn` could never be read as true.** The boot guard sets that state and
calls `runRefresh` in the same tick, so the closure still sees the old `false`
and the register never opened. Fixed by not reading it: every caller has already
established a session, and a request without one answers 401 and bounces anyway,
which is the right outcome regardless.

**2. The auto-load sent a stale selection.** `loadRegister` closed over `sel` and
`opts` as *state*, and the cascade calls it before React has committed a render
for the values it just computed. So a link whose course was plainly set arrived
with **"Choose a course first."**

The fix is structural, not a patch. The request is now `fetchRegister(levels,
dates)`, which takes the selection as arguments. `loadRegister` validates the
current state and delegates; the cascade passes `chosenLevels(lastReply, draft)`
— the values it is holding, not a snapshot of the last render. Two callers, one
function that talks to `/api/register`, so there is one place that can be wrong.

That is the same class of bug as the `optsRef` one AGENTS.md records, arriving
from a new direction: a value computed locally, read through state that has not
caught up.

## Consequences

- **A new smoke test**, asserting four things: arriving by hand sends nothing;
  following a link sends exactly one request and shows the register; reloading
  sends exactly one more, not two; and changing a level sends none.
- **Verified against the live portal.** Following a link produced 63 rows, no
  warning, and exactly one `POST /api/register`.
- **Two mutations are caught** — the link not opening, and the stale selection
  being sent. The other two mutations tested turned out to be no-ops, which is
  what removed the flag.
- `loadRegister` is now two functions. `App.tsx` is longer, and both are
  documented at the point where the reasoning is needed rather than at the top.

## Alternatives considered

**Keep it a click.** Rejected on the grounds recorded in ADR 0010. Revisited
because the cost was lower than estimated: the round trip only happens when the
URL names a register, and a link that stops one click short of showing the thing
it names is not doing its job.

**Auto-load on every arrival, subject or not.** Rejected: with no subject there is
nothing to load, and spending a request to discover that is the thing ADR 0010
objected to.

**Auto-load whenever the selection becomes complete, not just on arrival.** This
is the one worth naming, because it is the version that would have removed the
need to think about arrival at all — and it is the user's decision to lose. If
someone changes the subject from a dropdown, the register would swap under them
without being asked. `Load register` is the click that says "this one".
