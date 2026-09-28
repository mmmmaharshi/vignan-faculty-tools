# 0003 - Validate the portal seam, by making emptiness mean one thing

Date: 2026-09-28

## Status

Proposed

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

1. **Three levels are treated as never-empty**: courses, and the branches and
   semesters for a chosen course. One guard covers all three, and it raises a 502
   naming both plausible causes — the portal has changed, or the session has
   expired.

   This rests on an assumption, not a guarantee: that every course has at least
   one branch and one semester. That holds for everything observed so far, which
   is one course, so it is weak evidence. The failure mode if the assumption is
   wrong is a 502 where the user previously got an empty dropdown — worse, and
   worth revisiting if anyone reports it. It is accepted because the alternative
   is the silent stall this ADR exists to remove.
2. **Two levels are left unguarded**: sections for a course/branch/semester, and
   subjects for one. `README.md` already records that some combinations are
   genuinely empty, and gives IV Semester as an example — one section, and that
   section may teach nothing, so the subject list is legitimately `[]`. Whether
   any combination yields *zero* sections is not established either way, which is
   the same reason to leave it alone. The front end already handles an empty
   level by leaving the dropdown empty.
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
- The two legitimate-empty levels stay unguarded, so a genuinely empty subject
  list remains a silent empty dropdown. That is the accepted cost of not
  asserting where emptiness is real. It is also why the *client* shows a disabled
  subject dropdown rather than an error.
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
