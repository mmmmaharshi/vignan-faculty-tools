# ADR 0028: Home shows the day's class work with unposted rows tinted

## Status

Accepted. Supersedes the unposted-only shape: the section first shipped
listing only blank-count periods, and an all-posted day read "All posted".
Faculty asked for all tables instead, so the section is the day's report.

## Context

Faculty asked for an "Absentees Not Posted" section for the whole branch,
below the timetable. ECAP's ACADEMICS menu reaches it without any HOD login:
DAY CLASS WORK (`rptdayclasswork.aspx`) answers a per-section report for one
date — period, subject, staff, and the posted present/absent counts — through
`ShowDayClassWork` on its own proxy. A held period with blank counts is not
yet posted: every posted period in every live reply states both counts.

## Decision

Home reads the report through `POST /api/unposted`, below the timetable:

- The ask carries the faculty's own course and branch plus every semester
  the Portal counts into the academic year, over today on the campus clock
  (IST — a UTC server would ask for yesterday after 18:30 UTC). One call
  covers the whole branch; the section is always all of them.
- Course and branch are matched from the Portal's own lists by name. A
  refusal throws before the parser is reached, so it says the read failed
  rather than passing for all posted — and it stays in its own section,
  never failing the timetable above it.
- Every section renders its own table with the posted counts; rows with
  blank counts tint red with "—" cells, so the pending postings read at a
  glance. A report with no section blocks is no classes that day, which is a
  different answer from all posted.
- The section is scoped to the faculty's own branch (Information
  Technology). A branch the Portal does not offer fails named rather than
  reading another branch's periods.

## Consequences

- No new kind of Portal call beyond the report's own method, through the
  same handler shape as every other read.
- The row geometry is pinned against the live 23/10/2026 reply (all posted)
  plus the same block with one period's counts blanked.
