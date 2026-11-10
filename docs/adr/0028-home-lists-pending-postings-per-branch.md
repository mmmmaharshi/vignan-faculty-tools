# ADR 0028 — Home lists pending postings per branch

## Status

Accepted (amended): the presentation moved from a per-period table to per-period
boxes grouped by semester into cards, with branches chosen through a single
`Select`. The wire contract and the parser were unchanged by that amendment; a
later one adds the report's own absent-roll column to the modal (Amendment 2).

## Context

`ShowDayClassWork` (the Class attendance report's sibling) already states, per
section, which periods have posted attendance today. Home can reuse it to show a
faculty member what still needs posting, without a new Portal call.

## Decision

Home reads the report through `POST /api/unposted`, below the timetable:

- The ask carries the course, every offered branch, and every semester the
  Portal counts into the academic year, over today on the campus clock
  (IST — a UTC server would ask for yesterday after 18:30 UTC). One call
  covers the whole day; the section is always all of them.
- The course prefers B.Tech and falls back to the first offered course, so a
  faculty outside B.Tech reads their own branches; placeholders never
  travel. A refusal throws before the parser is reached, so it says the read
  failed rather than passing for all posted — and it stays in its own
  section, never failing the timetable above it.
- The panel offers every branch the report named in a single `Select`, defaulting
  to the first; the chosen branch's sections are grouped by semester into cards,
  and each section shows its periods as seven boxes — filled when that period's
  attendance is posted, empty otherwise. A period counts as posted only when
  every section's cell for it is posted. ECAP writes "-" where a period has not
  been posted; that is not a count of zero, so it reads unposted.
- A report with no section blocks is no classes that day, which is a
  different answer from all posted.

## Consequences

- No new kind of Portal call beyond the report's own method, through the
  same handler shape as every other read.
- The posted/blank geometry is pinned against the live 23/10/2026 reply (all
  posted) plus the same block with one period's counts blanked and with a dash.
- Staff and section attribution per pending period is no longer shown in this
  view; the boxes encode only posted/unposted per period. The register and
  student profile remain the place for a student's own figures.

## Amendment 2: the box names the absentees the report lists

The day-class-work reply's last column is headed `Roll.No's / Absent Students`
and carries the rolls that period marks absent. The parser ignored it; the modal
now states it, beside the counts, because a headcount answers "how many" and the
question a faculty member asks next is "who".

- It costs no Portal call: the column is in the reply the boxes already read, and
  was measured live on 2026-11-10 to agree with the `Absent` cell on every posted
  period checked.
- The list is the report's own, in its order, as written. It is not joined to the
  register, so it names rolls and not students; the register remains the place a
  name is read.
- A posted period that lists none says `None listed`, because an empty list is an
  answer and a blank reads as a fault.
- The absentees sit below the facts rather than in a facts cell: a period can list
  thirty of them, and half a two-column row turns that into a paragraph.