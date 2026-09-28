# 0003 - Validate the portal seam, by making emptiness mean one thing

Date: 2026-09-28

## Status

Accepted

## Context

ADR 0002 ported the codebase to TypeScript and deliberately left the portal seam
unvalidated. `#jq()` returns `any`, because `JSON.parse` gives nothing better and
the payload's shape depends on which portal method produced it. That was recorded
as debt, with one condition attached: the validation must come with tests, since
`CODING_STANDARDS.md:12` is right that an untested guard is close to decoration.

Looking at what actually goes wrong, the problem is not really typing. It is that
**an empty result means two different things and the code cannot tell them
apart.**

Today, if the portal's markup changes, `options()` finds no `<option>` elements
and returns `[]`. The cascade then stalls: the dropdown simply stays empty, with
no message, because an empty list is indistinguishable from a level that
genuinely has no options. The register is worse. `parseRegister()` finds no
`<table>` and returns `[]`, and the route answers *"The register came back empty.
Check that the subject has classes in that date range."* — blaming the date range
when the cause is that the reply was not the markup this code expects.

Both failures are silent, and both point somewhere other than the cause.

## Decision

Assert emptiness only where emptiness is not a legitimate answer, and say what
was actually received when it happens.

1. **Every level is guarded, because none of them is ever empty.** One guard
   covers all five, and it raises a 502 naming both plausible causes — the portal
   has changed, or the session has expired.

   This was originally written to guard three levels and leave sections and
   subjects alone, on the strength of a note in `README.md` saying some
   combinations are genuinely empty. That note has been checked against the
   portal: across all four branches and all three semesters — twelve
   combinations, which is the entire space this account can reach — sections
   return between one and four options and subjects between fifteen and fifty-one.
   Nothing is ever empty. Subjects are not scoped to a section, so those twelve
   cover them too. The one thing the check cannot cover is a course this account
   cannot see, and the portal offers it exactly one.

   `README.md` said "genuinely empty" about IV Semester, which has *one* section.
   That is a statement about count, not about emptiness, and it was the source of
   the wrong assumption.
2. **If the guard is ever wrong, the message is what limits the damage.** A 502
   where the user previously got an empty dropdown is a worse symptom. It is
   accepted because the alternative is the silent stall this ADR exists to
   remove, and because the message names both causes, so the report is
   diagnosable rather than baffling.
3. **A reply that is an HTML page is named as one.** Convention B answers with a
   JavaScript literal. When the portal session dies it can answer with markup
   instead, and `unquoteJs()` currently hands that straight on, where it becomes
   an empty list and inherits whichever of the two failures above fits. Detecting
   it at the point of receipt is the cheapest place to say "this was not data".
4. **An option with an empty value is not offered.** `options()` filters on the
   visible text alone, so an entry with a label but no identifier becomes a level
   the user can choose that resolves to nothing. The `-Select-` placeholder is
   filtered separately, in the route, by `realOptions()`.
5. **The register's 502 names both causes.** Not the date range alone.

Every one of these is a **pure function over a string**, with no portal call
inside it. That is the point: it is what makes them testable without a live
session, and a fixture string is all a test needs.

## Consequences

- `#jq()`'s return type stays `any`. This work does not change that, and should
  not be sold as if it does. What changes is that the paths where its `any` could
  cause silent damage now raise instead.
- Five fast unit tests become possible, over fixture strings, with no network and
  no credentials. That is the first thing in this project that is testable in
  milliseconds, and it is the reason the guards are shaped as pure functions
  rather than inline checks.
- An empty level now always raises, at every level, rather than only at three.
  The cost is that a genuinely empty one becomes a 502 rather than an empty
  dropdown. Decision 1 records the measurement behind that trade.
- A markup change now produces "ECAP returned no courses" instead of a dead
  dropdown. That is a better error, not a fixed bug.

## Alternatives considered

- **Validate every level as non-empty.** Rejected: it breaks the combinations
  that are genuinely empty, which `README.md` already documents as existing.
- **Type the portal payloads properly — a schema for each convention's reply.**
  Rejected as a much larger job that this does not need. The guards below catch
  the failures that actually occur, which are emptiness and non-data, not
  subtly-wrong field values.
- **Retry once on an unexpected reply.** Rejected: the portal session is the
  thing that expires, and retrying with a dead session just fails again more
  slowly.
- **Do nothing and rely on the 502s.** Rejected: the 502s exist and they name the
  wrong cause, which is worse than an honest dead end.
