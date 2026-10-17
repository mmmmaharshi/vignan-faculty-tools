# 04: The overall Attended of held column and the overall badge

**What to build:** The overall figure on a row is a pair, not a lone number: the
Portal's overall attended-of-held cell sits beside its percentage, and the
percentage carries its own Irregular or Critical badge. A student can be badged
on one and clean on the other, which is the case this app exists to catch.

**Blocked by:** 01 — Read the Class attendance report and show each student's
Overall %.

**Status:** ready-for-agent

- [ ] The table carries two overall columns: overall attended of held, and
      overall %.
- [ ] The overall attended-of-held cell is displayed exactly as the Portal wrote
      it and is never split into its two numbers. The glossary forbids modelling
      the two halves of such a cell and that rule holds here too.
- [ ] The overall percentage carries its own badge: below 75 is Irregular,
      below 60 is Critical, using the app's existing thresholds rather than new
      ones.
- [ ] A percentage of exactly 75 is not Irregular. A percentage of exactly 60 is
      not Critical. Both are the app's existing boundary behaviour, unchanged.
- [ ] The Subject badge and the overall badge are independently coloured, so a
      student who is failing one Subject while healthy overall shows one badge
      and not the other.
- [ ] A student with no overall figure shows a dash and carries no overall
      badge.
- [ ] The row's background tint continues to be driven by the Subject bands. An
      overall problem on its own does not change a row's tint, because that tint
      is what "Show only irregular students" is filtering on.
- [ ] Filtering to irregular students uses the Subject bands, as it does today,
      and the overall badge does not silently change which students the filter
      keeps.

## Comments

**Amended 2026-10-17: the two overall columns are on the All subjects view.** The
first criterion reads as though they sit beside a Subject's own; what shipped
shows them on **All subjects** alone (`overallMode` in
`web/components/RegisterTable.tsx`, pinned by `test/smoke.spec.ts`). Everything
else in this ticket holds on both paths.

**The filter criterion now holds on both paths.** A subject register reads the
Subject band; All subjects reads the overall band, which is the band that view
shows. The subject path used to *also* admit a student for the overall band while
displaying no overall figure, so a row could be kept for a band with nothing on
screen to explain it. `visibleStudents` in `web/worklist.ts` no longer does that —
each path reads the figure and the band its own table shows, and a student whose
only trouble is overall is surfaced on All subjects.

**And the Critical threshold is 65, not 60** — see ticket 03.
