# 0006 - Give the attendance bands a module

Date: 2026-09-28

## Status

Accepted

## Context

`CONTEXT.md` names Regular, Irregular and Critical as domain terms, and closes
with a constraint:

> The three bands are the app's own thresholds and are stated once, in
> `IRREGULAR_BELOW` and `CRITICAL_BELOW`. Do not introduce a fourth band without
> an ADR.

The glossary was right about the vocabulary and wrong about where it lived. The
thresholds were stated in two `const` lines at the top of `server.ts` — and the
rule that actually *applies* them was anonymous code further down: a `map`
setting two booleans, then three separate `filter`s counting them, then a
`reduce` for the average. Thirty-one lines with no name, inside a route body.

That gap matters for a reason the glossary does not state. A count computed by a
different traversal from the flag is a count that can disagree with it, and the
disagreement is invisible until someone reads the screen. The smoke test already
cross-checks the flagged-row count against the stat card — but it costs a live
round trip to a real portal, it covers the irregular count only, and it is the
test most likely to be skipped when `ECAP_USER` is unset.

Nothing tested the boundaries themselves. `74.99` and `60` were reachable only by
reading the arithmetic and hoping.

## Decision

`attendance-bands.ts` owns the bands, the flags and the summary.

- `band(pct)` answers which band a percentage is in, and returns `null` for a
  percentage the portal could not give us.
- `withBands(row)` attaches the two flags.
- `summarise(rows, range)` produces the whole reply — students, flags, counts,
  average, thresholds — in **one pass** over the rows.

The one-pass decision is the point. The flags and the counts are no longer two
traversals that happen to agree; they are the same traversal, so they cannot
disagree. The invariant `critical ≤ irregular` is now a structural consequence
rather than something a test has to police, though a test does police it anyway.

The thresholds stay on the server, which is what applies them, and still travel
to the client in the summary so the stat cards are labelled from the numbers that
produced the flags.

## Consequences

- **15 tests, 793 ms, no portal and no browser.** Every one proven to fail by
  breaking the rule it describes: critical not implying irregular, nulls averaged
  as zero, an unknown percentage called Regular, the threshold becoming "at most",
  the irregular count derived from the critical flag, and the thresholds
  ceasing to travel. Each was caught by the test naming that failure.
- **The boundaries are now stated in tests, not arithmetic.** 75 is regular and
  74.99 is not; 60 is irregular and 59.99 is critical. Both thresholds are `below`,
  so there is no overlap and no gap, and a student at exactly 75 cannot land in
  the wrong list.
- **An unparseable percentage is in no band and is excluded from the average.**
  That was already the behaviour; it is now a decision with a reason attached. A
  parsing failure is not evidence of bad attendance, and averaging it in as zero
  would drag the class figure down and misdescribe every other student in the
  room.
- **`RegisterRow` is declared once**, in this module, and `portal-replies.ts`
  re-exports it. The parser and the bander cannot now disagree about what a row
  is.
- `server.ts`'s `/api/register` body lost 31 lines and gained one call. Its
  remaining job is the 502 for an empty register and the per-level validation —
  which is what a route body should be doing.

## Alternatives considered

**A fourth band, for the 90% line.** Rejected. `CONTEXT.md` requires an ADR and
this is not one: the argument would be that three bands answer three questions
("any concern", "worth a check-in", "act now") and a fourth would answer a fourth
question nobody has asked. The honest position is that a band earns its place by
a decision someone actually makes differently because of it, and no one has said
that yet.

**Keep the thresholds in `server.ts` and only extract the counting.** Rejected as
half a move. The thresholds are the rule; the constants were the only place they
were named, and leaving them behind would have left the module reading a number
from elsewhere. One home, or the glossary's "stated once" is not true.

**Have the client compute the bands.** Rejected. The server already flags every
row, and the client drawing its own would give two answers to one question — the
exact disagreement this module removes. The thresholds travelling in the summary
is the compromise: the client labels what it is told, and never decides.
