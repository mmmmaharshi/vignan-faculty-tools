# ADR 0028: Home lists pending postings per branch

## Status

Accepted. Supersedes two earlier shapes: the section first shipped listing
only blank-count periods, then a ticked branch-by-section matrix. Faculty
asked for the exceptions only — no details — so this records what replaced
both.

## Context

Faculty asked for an "Absentees Not Posted" section for the whole branch,
below the timetable. ECAP's ACADEMICS menu reaches it without any HOD login:
DAY CLASS WORK (`rptdayclasswork.aspx`) answers a per-section report for one
date — period, subject, staff, and the posted present/absent counts — through
`ShowDayClassWork` on its own proxy. A held period with blank counts is not
yet posted: every posted period in every live reply states both counts.

## Decision

Home reads the report through `POST /api/unposted`, below the timetable:

- The ask carries the course, every offered branch, and every semester the
  Portal counts into the academic year, over today on the campus clock
  (IST — a UTC server would ask for yesterday after 18:30 UTC). One call
  covers the whole day; the section is always all of them.
- The course is matched from the Portal's own list by name; placeholders
  never travel. A refusal throws before the parser is reached, so it says
  the read failed rather than passing for all posted — and it stays in its
  own section, never failing the timetable above it.
- The panel shows one branch after another: each pending period with its
  section and the staff it waits on; a fully posted branch reads as one
  line. No subjects, no counts — the exceptions are the whole answer.
- A report with no section blocks is no classes that day, which is a
  different answer from all posted.

## Consequences

- No new kind of Portal call beyond the report's own method, through the
  same handler shape as every other read.
- The posted/blank geometry is pinned against the live 23/10/2026 reply (all
  posted) plus the same block with one period's counts blanked.
