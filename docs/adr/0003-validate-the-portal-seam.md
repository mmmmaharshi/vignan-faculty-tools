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

1. **Every level is checked, and an empty one is reported rather than
   refused.** `OptionsReply` carries `emptyLevels`: the levels that were asked
   for and came back nothing. The front end shows which, and carries on.

   Every branch and semester the portal offers has been checked — twelve
   combinations, the entire space this account can reach — and nothing has ever
   come back empty. Subjects are not scoped to a section, so those twelve cover
   them too. The one thing the survey cannot cover is a course this account
   cannot see, and the portal offers it exactly one.

   That gap decided the shape. An earlier version of this ADR threw a 502 for an
   empty level, which meant a course nobody here has observed could block the
   screen for everyone, on the strength of an assumption. Reporting degrades
   instead: the user sees which level is empty, is told it may be a layout
   change or a branch that does not run this semester, and every other level
   keeps working.

   `README.md` said "some combinations are genuinely empty" about IV Semester,
   which has *one* section. That is a statement about count, not about emptiness,
   and it was the source of the wrong assumption.
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
- An empty level no longer stops anything. It is named on screen, the reason is
  given as two possibilities rather than one, and the rest of the cascade carries
  on. That is a better error *and* a better degradation than either throwing or
  staying silent.
- A markup change now produces a named warning rather than a dead dropdown. That
  is a better error, not a fixed bug.

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
