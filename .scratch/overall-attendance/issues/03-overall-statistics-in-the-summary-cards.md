# 03: Overall statistics in the summary cards

**What to build:** With All subjects chosen, the summary cards describe the
class's overall attendance. With a real Subject chosen they are exactly as they
are today. The cards and the table always describe the same thing.

**Blocked by:** 01 — Read the Class attendance report and show each student's
Overall %.

**Status:** ready-for-agent

- [ ] With All subjects chosen, the cards show the student total, the overall
      class average, the count below 75 overall, and the count below 60
      overall.
- [ ] With a real Subject chosen, the four cards are unchanged from today:
      students, class average, below 75, below 60 — all Subject-scoped.
- [ ] The overall class average ignores students the Portal gave no overall
      figure for, rather than counting them as zero. An absent figure is not
      evidence of bad attendance.
- [ ] The overall class average is absent when no student has an overall figure,
      and its card shows a dash rather than a zero.
- [ ] The number of overall-badged students in the table equals the number in
      the overall card. They come from one pass and cannot disagree.
- [ ] The thresholds named in the card captions are the app's existing
      thresholds, unchanged. No new threshold is introduced.
- [ ] A student counted in the register total is also counted in the student
      card, so the row count, the table and the cards agree.

## Comments

**The Critical threshold is 65, not 60.** Two criteria above say "below 60". The
app's own `CRITICAL_BELOW` is 65 (`attendance-bands.ts`, **Critical** in
`CONTEXT.md`), which is what "the app's existing thresholds, unchanged" asks for.
The cards read 75 and 65, and they always have.
