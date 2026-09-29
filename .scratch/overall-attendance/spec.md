Status: ready-for-agent

# Spec: Overall attendance per student

## Problem Statement

The app reads one Register at a time: a faculty member picks a Course, Semester,
Branch, Section and Subject, and gets that Subject's roster with each student's
Attended of held and percentage. There is no way to see how a student is doing
across the whole Section.

That matters because a student can be perfectly healthy overall and failing one
Subject, and the reverse is just as common. Right now neither fact is visible
next to the other, so spotting the first case means opening every Subject by
hand and doing the arithmetic in a head or a spreadsheet. The Portal already
produces the Section-wide figure — ECAP's Class attendance report — and the app
simply never asks for it.

## Solution

Add the Portal's class-wide overall attendance to the Register.

Concretely: every Register row gains two more columns, **Overall Attended of
held** and **Overall %**, read from ECAP's Class attendance report for the same
Section and the same date range. The overall percentage gets its own
Irregular/Critical badge using the app's existing thresholds, so the two
figures on a row can disagree and both still show.

The Subject level of the Cascade also gains an **All subjects** entry. Choosing
it loads the Class attendance report on its own, with no Subject register behind
it, and the summary cards switch from Subject statistics to overall statistics.

No new arithmetic is introduced anywhere. The Portal states the overall
percentage in its own cell and the app displays it.

## User Stories

1. As a faculty member, I want each student's overall attendance in the same
   table as their Subject attendance, so that I can see both without switching
   screens.
2. As a faculty member, I want the overall column to carry its own Irregular
   and Critical badge, so that a student who is failing one Subject while
   healthy overall is visible at a glance.
3. As a faculty member, I want the subject badge and the overall badge to be
   independently coloured, so that I can tell which of the two is driving my
   concern.
4. As a faculty member, I want to choose **All subjects** in the Subject level,
   so that I can load the Section's overall attendance without picking a Subject
   first.
5. As a faculty member, I want the summary cards to show overall statistics
   when **All subjects** is chosen, so that the cards describe the same thing
   the table does.
6. As a faculty member, I want the summary cards to keep showing Subject
   statistics when a real Subject is chosen, so that nothing regresses in the
   state I already use.
7. As a faculty member, I want the overall figure to honour the date range I
   already chose, so that the two columns on a row are describing the same
   period.
8. As a faculty member, I want the date range to stay visible above the table,
   so that I do not read a month-to-date overall as a semester one.
9. As a faculty member, I want a student with no Portal-supplied overall figure
   to show a dash rather than a zero, so that missing data is not mistaken for
   bad attendance.
10. As a faculty member, I want such a student to still appear in the register,
    so that nobody silently disappears from my class list.
11. As a faculty member, I want such a student to carry no overall badge, so
    that an absence of evidence is not shown as evidence of absence.
12. As a faculty member, I want a student who is absent from the class-wide
    report to be excluded from the overall class average, so that the average
    reflects students the Portal actually scored.
13. As a faculty member, I want a student who is absent from the class-wide
    report to still count toward the register total, so that the row count and
    the table agree.
14. As a faculty member, I want the overall columns to survive a Portal layout
    change as a clean failure, so that I am told rather than shown a wrong
    number.
15. As a faculty member, I want the **All subjects** entry to be visually
    distinct from a real Subject, so that I do not load it by accident.
16. As a faculty member, I want the chosen-levels line above the table to name
    what is actually loaded, so that "All subjects" is never mistaken for a
    Subject I taught.
17. As a faculty member, I want **Load register** to remain the only thing that
    fetches a register, so that no request fires without my asking for one.
18. As a faculty member, I want the existing Subject-only behaviour to be
    byte-for-byte unchanged when the overall call fails, so that a Portal blip
    does not take away the report I already had.
19. As a maintainer, I want the overall percentage to be read from the Portal's
    own cell rather than recomputed, so that there is exactly one source of
    truth for it.
20. As a maintainer, I want the overall Attended of held cell treated as an
    opaque string, so that the app keeps its rule of never parsing that cell.
21. As a maintainer, I want the band thresholds for the overall percentage to
    be the same constants the Subject percentage already uses, so that the two
    cannot drift apart.
22. As a maintainer, I want the class-wide figures to be joined on roll number,
    so that a student is matched by identity and not by row position.
23. As a maintainer, I want the join to be a single pass in the same place the
    Subject flags are computed, so that the row and the card cannot disagree.
24. As a maintainer, I want the Portal call to sit behind the existing reader
    seam, so that the whole feature is testable without the network.
25. As a maintainer, I want the new Portal convention documented in the same
    place the other two are, so that the next person does not have to scrape
    the Portal again to find it.

## Implementation Decisions

### Reading the Portal's declared figures, never recomputing them

The Class attendance report states each student's overall as a combined
attended-of-held cell and a percentage cell, in that order, as the last two
cells of the row. Both are read as the Portal wrote them.

No arithmetic is performed on either. In particular the combined cell is **not**
split into its two numbers: the glossary already forbids modelling the two
halves of an attended-of-held cell, and the fact that the combined cell's halves
happen to equal the sum of the Subject columns is a property of the Portal, not
a contract we get to depend on. The percentage is displayed, never derived.

This decision is recorded in a new ADR.

### The Portal call

One remote method on the report page behind **Attendance Reports → Class** in
the Portal sidebar. It is invoked through the same generated-proxy calling
convention the Academic Register already uses, on a different proxy file, with
the same name-encoding helper.

The method takes thirteen values, in this order: Course id, Branch id,
Semester id, Section id, from date, to date, Course name, Branch name, Semester
name, Section name, a JNTU-format flag, a hostel-only flag, and an
exclude-other-subjects flag. All thirteen are sent on every call; the three
flags are always false, because the readable report shape is wanted and the
report must span every subject in the Section.

The pair list is built by a pure function beside the existing calendar pair
function, so that the wire shape is testable without a Portal.

Dates are sent in the Portal's own day-first form. The chosen range already
travels in that form for the register, so this is the same conversion, not a
second one.

### Parsing

A new pure parser, beside the register parser, takes the report's HTML and
returns one record per student: roll number, overall attended-of-held, overall
percentage.

The parser locates the header row by its roll-number label rather than by
position, because the report carries a title block and a preamble above the
grid. It then reads the final two cells of each data row. A row is a data row
only if its first cell is a number, which excludes the header band, the held
band, and any footer.

A percentage cell the Portal left blank becomes null, not zero.

### Choosing which figures to show

The Subject level of the Cascade gains an extra entry meaning **All subjects**.
It is a sentinel, not a Portal Option, so its value cannot collide with a real
Subject identifier.

When the sentinel is chosen:

- the subject register is not fetched at all;
- the class-wide report is fetched on its own and becomes the whole table;
- the Subject columns are not rendered, because there is no Subject for them to
  describe;
- the summary cards show overall statistics instead of Subject statistics.

When a real Subject is chosen:

- the subject register is fetched as it is today;
- the class-wide report is also fetched for the same range;
- the two are joined on roll number and the overall pair of columns is added to
  the existing columns;
- the summary cards are unchanged.

### The join and the bands

The join happens in one pass in the module that already computes the row flags
and the summary, so a row's flag and the card's count come from the same
iteration.

A student present in the class-wide report but absent from the Subject register
is not added: the Subject register is the authority on who is in the class.

A student present in the Subject register but absent from the class-wide report
keeps their row, gets a null overall percentage, and is in no overall band. They
are counted in the register total and excluded from the overall class average.

Overall bands reuse the existing irregular and critical thresholds rather than
introducing new ones. The three-band vocabulary is unchanged; only the number of
things it is applied to increases.

### Failure behaviour

If the class-wide call fails or its layout has changed, the Subject register
still renders. The overall columns are simply absent for that load. This is
deliberate: a missing new feature must not remove an existing one, and the
alternative — failing the whole load — would make the Portal's Class attendance
page a dependency of the Academic Register.

The same discipline the register already uses applies: an empty or unreadable
report is a distinguishable error, not a table of zeroes.

### Contract changes

The student record on the wire gains the overall attended-of-held string, the
overall percentage, and the two overall band flags. The register reply's
summary gains the overall average and the overall irregular and critical counts.

The reader seam gains one method that returns the report's HTML. Everything
downstream of it is pure.

### Glossary

The vocabulary file gains one term for the Section-wide figure, and its existing
**Subject** entry is corrected. That entry currently states there is no single
average for a Section; the Portal's Class attendance report does provide one,
and the entry now says so.

## Testing Decisions

A good test here asserts a property a reader would check, not a mirror of the
code. In particular: no test asserts that a percentage equals a division of two
numbers the test itself derived, because that would pass when the app is wrong.
Tests read the Portal's cells and assert the app shows them, and assert the
band boundary behaviour.

**Two seams, both existing.**

The **route-handler seam over a fake Portal reader** is the highest seam
available and carries almost the whole feature: the join on roll number, the
sentinel skipping the register fetch, a missing roll yielding a null rather than
a zero, the overall bands, the overall average, and the counts in the summary.
This is the seam most of the feature should be proven at.

The **parser seam over fixture markup** carries exactly one thing: that the
report's HTML shape is read correctly — the grid located by its roll-number
header rather than by position, the preamble excluded, the last two cells taken
as the overall pair, a blank percentage becoming null, and a row whose first cell
is not a number being skipped.

The HTTP call itself is not unit tested. That is what the end-to-end smoke test
is for, and it is the existing prior art for proving the Portal really answers.

**End to end.** The smoke test gains two assertions at the highest level
available: the overall columns are on screen for a real class, and the count of
overall-badged rows equals the number in the overall summary card. Those two
break for their own distinct reasons.

**Proving the tests can fail.** Before this feature is considered done, each new
named test is run once against a deliberately broken build and confirmed to turn
red. The seam parser test in particular must be checked for the way the
register's parser test was: a test that cannot fail is a decoration.

## Out of Scope

- Any client-side arithmetic on attendance figures. The Portal states them.
- Any hours-can-skip or hours-to-recover calculation. Explicitly declined.
- Changing the Regular / Irregular / Critical thresholds, or adding a fourth
  band.
- Splitting any attended-of-held cell into its two numbers, for either the
  Subject figure or the overall one.
- Caching the class-wide report, or any other caching. The cost is one extra
  Portal call per load and is not yet measurably slow.
- A semester start date, or any Semester-to-date default. The Portal has none
  to give; `GetDates` returns month-to-date and the date pickers carry no
  bounds. The user's chosen range is the definition of the period.
- Restructuring the Cascade or the existing Subject-only path.
- Any change to sign-in, sessions, routing or the rail.
- Instructor or lab-level breakdowns beyond what the Class attendance report
  already returns.
- Any use of the Portal's other attendance screens — the day-wise posting
  screen, the cumulative student-wise register, the shortage and absentee
  reports — none of which this feature needs.

## Further Notes

**The wire contract was measured, not guessed.** The Portal's method name, its
parameter names and its parameter order were read out of the generated proxy
definition the report page loads, which is where the exact contract lives. Two
things cost time and are worth not repeating: the parameter names are
Pascal-cased and not the camel-cased names the page's own JavaScript appears to
use, and the session marker in the query string differs per method.

**Two calling conventions exist and using the wrong one returns an empty result
with no error.** The method reached here through the generated-proxy convention
is not reachable through the JQuery convention; the JQuery route returns a
generic server error for this particular method while working fine for others on
the same endpoint. This is the fourth distinct trap of this family and belongs
in the agents' guidance alongside the existing three.

**The report's held total is a class constant, not a per-student one.** During
the spike the held half of the overall figure was identical for every student in
the Section and shifted correctly with the date range. The app does not use
this, because it never splits the cell — but it is the reason the Portal can
answer with a single row of held counts, and it is why a range that predates a
student's enrolment may report a figure that flatters them.

**The date range is the only definition of the period, on both columns.** A row
showing 82% for a Subject and 79% overall is describing the same range in both
cells. The line above the table already names the range and must keep doing so.
