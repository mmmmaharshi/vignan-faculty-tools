# 0017 - Read the portal's declared totals, never recompute them

Date: 2026-09-29

## Status

Accepted

## Context

The Portal has a second attendance screen the app did not use: **Attendance
Reports → Class**, behind `ACADEMICS/rptstudentsattendance.aspx`. Its report gives
one row per student in a section, with every subject as a column, and two
trailing cells — a combined attended-of-held cell and a percentage.

So the Section-wide figure the app lacked was never missing. It was one screen
away, and the app simply never asked.

The obvious implementation is to derive it. The report's subject columns are
right there, and summing them is arithmetic the app could do. That was the first
plan, and it was wrong for a reason the spike made visible.

Measured against a real section — 69 students, one date range, two ranges
actually — the Portal's declared cell and the sum of its own subject columns
agreed **69 out of 69 students, in both ranges, with no discrepancies**. And the
Portal's percentage agreed with `attended / held × 100` rounded to two places,
69 out of 69.

Agreement is exactly why recomputing is the wrong move. The moment the app keeps
its own copy, there are two numbers that happen to match today, one of which the
app is responsible for keeping right. The Portal's layout can change and the
declared cell can move to a different column; a derived total would keep
producing a plausible number from the wrong cells, and nothing would say so.

`CONTEXT.md` had already settled the related question about the combined cell:

> The app displays it and never parses it, so the two numbers inside it are not
> separately modelled and must not be reasoned about as if they were.

The subject percentage was never computed by this app, and neither is the overall
one. The only numbers the app owns are the two band thresholds.

## Decision

The overall figures are **read from the Portal's own cells and displayed**. The app
never derives one attendance figure from another.

- `parseClassAttendance` locates the grid by its roll-number header rather than by
  position, bounds the scan to the table that header is in, skips the held band
  and the title block, and takes the **last two cells of each data row**. A row is
  a data row only if its first cell is a number.
- The combined cell is carried as the Portal wrote it. Its two halves are
  **reordered for the reader** and nothing else: the column is labelled
  all-classes-first and the Portal writes attended-first, so `381\481` is shown
  as `481 / 381`. No figure is derived from it — the two halves are never added,
  divided or compared. The reorder is safe because the spike established which
  half is which, 69 of 69 in both ranges.
- The percentage is rendered as received. A cell the Portal left blank becomes
  absent, not zero, because an absent figure is not evidence of bad attendance.
- The bands are the app's own `IRREGULAR_BELOW` and `CRITICAL_BELOW`, applied to
  the Portal's number. No fourth band, and no new threshold.

The one number the app still computes is the **class average**, which is a mean of
the Portal's percentages rather than a percentage of anything, and it was already
there for the subject register. It rounds to one decimal in both paths.

## Consequences

- **The overall column cannot silently disagree with the Portal.** It is a copy of
  a cell, so the only way it is wrong is if the cell was wrong.
- **A layout change is visible instead of silent.** If the grid stops being
  findable, the parser returns nothing, which the route turns into a named 502 on
  the All-subjects path and into an absent column on the subject path. A derived
  total would have kept answering from whatever cells happened to be last.
- **The combined cell stays unmodelled.** `overallAttendedOfHeld` is a string, in
  the same way `attendedOfHeld` is, and neither half is separately available to
  anything.
- **Subject and overall can disagree, on purpose.** A student can be Regular on a
  subject and Critical overall. The two bands are independent and both are shown,
  because either one alone can be the reason to act.
- **The class report's held half is a class constant, not a per-student one.** In
  the measured data it was identical for every student in the section and moved
  correctly with the date range. That is why the Portal can answer with a single
  band row. It is also why a range that predates a student's enrolment can flatter
  them, and the app has no way to detect that and no business inventing a
  semester boundary to avoid it.
- **The date range is the only definition of the period, on both columns.** A row
  showing 82% for a subject and 79% overall is describing the same range in both
  cells.
