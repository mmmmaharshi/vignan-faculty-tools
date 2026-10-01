Status: ready-for-agent

# Spec: The dashboard shows a saved section

## Problem Statement

Every session begins the same way: sign in, wait for the Cascade to fill, choose a
Subject, choose a date range, press `Load register`. For a faculty member who
wants the same class every day, that is five decisions repeated five days a week to
reach a number they already know.

It matters more than a small annoyance. This app exists to catch a student who is
drifting, and a student can be healthy in the one Subject you happen to open and
Critical across the Section. Seeing that means opening every Subject in turn and
comparing them by eye. The Portal has no page that gives it directly, but every
figure needed is already in the Register's own summary — the app asks for the
Subject and already has the answer.

## Solution

Save the class, and show it.

**The saved unit is a Section**, and the dashboard shows **one row per Subject** in
it. Four values are stored — Course, Semester, Branch, Section. No Subject, and no
dates.

Two facts about the domain made the obvious design wrong, and both are recorded in
`docs/adr/0016-dashboard-shows-a-saved-section.md`:

**A faculty member teaches several Subjects in one Section**, and a lab carries a
smaller roster than its theory. So "the class" is not one thing.

**Attendance is recorded per Subject, never per Section.** A Section taught three
Subjects has three averages, three below-threshold counts and three different
denominators. There is no class average for a Section that does not average
averages — and one that did would describe no student in any of them. So there is
no section-wide average on this screen at all. The rows are comparable because
they share one date range, not because they are averaged.

The register moves to its own page, unchanged. What changes is that the summary
and the roster stop sharing a screen.

## User Stories

1. As a faculty member, I want to save the class I teach, so that reaching it
   every morning is not five decisions.
2. As a faculty member, I want each Subject of that class as a row with its
   Students, class average and below-threshold counts, so that I can see which
   Subject is in trouble without opening each one.
3. As a faculty member, I want the rows to share one date range, so that they are
   comparable with each other.
4. As a faculty member, I want a Subject I can no longer read to still show its
   row, so that a missing row never reads as a Subject with no problems.
5. As a faculty member, I want my saved class offered only to me, so that a
   shared machine does not hand my class to the next person to sign in.
6. As a faculty member, I want the register to keep its own page, so that choosing
   a different class is still possible and the roster still loads on a click.
7. As a faculty member, I want `Show only irregular` to include a student who is
   healthy in the Subject but Critical overall, so that the filter does not hide
   the student this app exists to catch.

## Out of scope

- **A Section-wide average.** Unanswerable — see above. ADR 0016 rejected it.
- **Caching a number.** Every visit refetches. Attendance is the one figure in
  this app where being stale causes harm.
- **Storing labels.** They are rebuilt from the Cascade, so a renamed class shows
  under its new name.
- **The selection in the URL.** ADR 0015 removed it deliberately.
- **"Who is in trouble across all my Sections."** The strongest next idea, but it
  depends on unverified Portal capability and fans out hundreds of round trips
  against a session that dies in 15–45 idle minutes. It builds on this.

## Notes for the implementer

**Read `docs/adr/0016-dashboard-shows-a-saved-section.md` first.** This spec
implements it. The ADR was written on 2026-09-29 and three facts it depends on
have since changed; the corrections are ticket 03's acceptance criteria, and
they are not optional:

- The critical threshold is now 65, not 60. Label the threshold columns from the
  summary the Register already returns, never from a number in the markup.
- The register opens at the remembered range start when there is one. The
  dashboard must use the same range, or the rows and the register disagree.
- The Subject level now auto-fills, so the All subjects entry leads the Subject
  list. It must be skipped when building rows, or the Section's students are
  counted twice.

**One number to measure before ticket 03 is trusted:** how long a dashboard visit
takes against the heaviest Section. N Subjects × 2 Portal calls, against a session
that dies in 15–45 idle minutes. This is the most likely reason the whole feature
is wrong, and it is measurable without changing anything.
