# 0026 - The semester's class counts are counted from the Cumulative grid

Date: 2026-11-04
Status: Accepted

## Context

The student panel shows Total Held, Total Attend and Total Absent for the
semester — the three figures ECAP's Academic Register prints when the faculty
picks **Student-wise** and **Cumulative** over the semester start to today.

ADR 0017 says attendance figures are read from what the Portal states and never
recomputed, because a recomputed figure quietly disagrees with the Portal while
looking authoritative. That rule holds for every percentage this app shows.

It does not hold for these three. Measured live on 2026-11-04, the Cumulative
reply states its totals as **empty spans**:

```html
Total Held:<span id="spnheld"></span>
Total Attend:<span id="spnattend"></span>
Total Absent:<span id="spnpercent"></span>
```

The page's own script fills them from the day grid it has just rendered, which
is one row per day and one cell per period, each cell painted with a colour the
reply's own legend names: green Holiday, yellow Absent, red Not Entered, purple
No Class Work, and no colour for an attended period. There is no second reply,
and no other method, that states the three numbers as text.

## Decision

Count them, but only here, and only from ECAP's own marks:

- Held is the periods that ran — attended, absent and not-entered cells. A
  holiday or a no-class-work period never ran and is not held.
- Attend is the uncoloured, non-empty cells; Absent is the yellow ones.
- The colour-to-word mapping is **read from the legend the reply carries**, not
  hardcoded. A colour the legend does not name, or no legend at all, means the
  totals are left out rather than guessed — a shifted legend must not turn into
  a printed 100%.
- The window is the semester start through today, the same one that screen
  uses, and totals are asked for only when the start is known.

## Consequences

- The panel can disagree with ADR 0017's letter and still agree with its
  purpose: the numbers are ECAP's own marks, counted once, with no arithmetic
  beyond addition.
- A Portal change that drops the legend or renames a colour leaves the section
  absent instead of wrong, and the seam test fails the moment the shape moves.
- The percentages this app already shows are untouched: they stay read.
