# 0029 - The month table is one class report per month

Date: 2026-11-10
Status: Accepted

## Context

A faculty member writes a monthly counselling report for a student, and needs
that student's cumulative attendance at the end of each month: 65% at the end of
September, 75% at the end of October, and so on. The figure is cumulative —
every month's window starts at the semester start — because a monthly report
quotes the term so far, not the month alone.

ADR 0017 says attendance figures are read from what the Portal states and never
recomputed, and every percentage this app shows obeys it. The Cumulative grid
ADR 0026 counts is counts only: ECAP states no percentage there, so a percentage
derived from those counts would be this app's arithmetic, and it would disagree
with what ECAP prints the moment the two windows differ by a period.

The only reply that states a cumulative percentage for a student is the class
attendance report (`ShowAllAttendance`) over a date range. Its own page offers
All / Monthly / Period modes, and ADR 0021 measured that all three are the same
method over a different range — there is no single reply that states one figure
per month. So a month-by-month table costs one report per month.

## Decision

Read ECAP's stated figure, once per month, inside the read the panel already
makes when it opens:

- Every window starts at the semester start and ends at that month's own last
  day, or at today for the month still running. The months run from the semester
  start's month through the current one.
- The rows are asked in parallel: they need nothing from each other, so the
  table costs one round trip rather than one per month in sequence.
- The figure travels as ECAP stated it. Nothing is divided, and a row with no
  figure reads a dash rather than a zero.
- A month ECAP refuses with a 502 leaves that row blank and the rest of the table
  standing. A month that refuses the session is still a 401, so a dead session
  signs out.
- No semester start, or no open register to name the section with, means no
  table. Both are already required for the semester's totals, so the panel's
  answer cannot be more complete than its inputs. A roll is matched through
  `sameRoll`, the one rule both panels already use, so a casing difference
  between ECAP's report and the row on screen cannot blank every row.

## Consequences

- A panel open now costs one profile page, one Cumulative grid, and one class
  report per month — around seven Portal calls for a semester in its fifth
  month, rather than the two ADR 0018 described. They go out together, so it is
  still one round trip, but it is the heaviest read in the app.
- The percentages agree with the Portal by construction, which is the whole
  point of the table: a faculty member copies these into a report they sign.
- The month count is bounded by the same twelve-month cap the semester walks
  use, and a start older than the cap keeps its **newest** rows: the table exists
  to show where the student stands now, so a stale start date cannot make it stop
  short of the month in progress.
- The months share a 15-second budget. A month still in flight when it runs out
  is the blank row a refused month already earns, so the GPA, the totals and the
  absences answer on time instead of dying with the panel. A 401 that arrives
  inside the budget still ends the session.
- The Student Search screen reads the same table through `handleFind`, so the
  panel cannot show the months when a register is open and hide them when the
  same student was found by roll number.
- If the cost ever bites, the table is the first candidate for a
  click-to-read — the decision was to have it there on open, and this ADR is
  what would be amended.
