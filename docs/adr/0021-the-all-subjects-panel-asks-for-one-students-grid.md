# 0021 - The All subjects panel asks for one student's own grid

Date: 2026-10-17

## Status

Accepted

## Context

A register row opened onto a panel shows, among the rest, the dates that student
was absent. On the subject path those dates are free: the register
(`ShowAcademicCalendar`) lays one column per day the subject met, its cells say
`P` or `A`, and `parseRegister` reads them off the row.

The **All subjects** path has no such grid. It reads the Class attendance report
(`ShowAllAttendance`), which aggregates **by subject**: its header is
`Sl.No | Roll.No | Student Name | MFCS | UHV | … | Total | Percent`, with zero
date columns. Measured against the live capture, that is not a layout accident —
the report's own page offers All / Monthly / Period modes, all of them the same
method over a different date range, and none of them day-wise. So on this path
there are no absent dates to show, and the panel showed none.

The question was what it would cost to have them.

The Portal does carry the data, on a second mode of the **register** page that
the app had never called: Student Wise, with a Detailed / Cumulative choice. In
its Detailed form, `ShowAcademicCalendar_StudentWise(rollNo, sectionId, courseId,
courseName, branchId, branchName, semesterId, semesterName, studentName,
allowPrint, fromdate, todate)` answers for **one roll number** and lays a column
per day the section met — `Sl.No | Subject | 05/08 … 16/10 | Atted/Held | %`,
sixteen subject rows for a real section, one mark per period inside a cell. Its
`_Cumulative` sibling states no dates at all.

Two shapes were available:

- **One register call per subject**, unioned: the register the app already reads,
  asked once for each subject in the section — sixteen calls for this section,
  on every load.
- **One call for one student**, over that student's own report, when their panel
  opens.

## Decision

The All subjects panel's absent dates come from **that one student's own Student
Wise report**, asked for inside the read the panel already makes.

- **Only on the All subjects path.** `handleStudentProfile` asks for the grid
  when the register the row came from was the section-wide one, and on no other
  path — a subject register's rows already state the dates, so asking again would
  be a call for an answer already on screen. The check is
  `isAllSubjects(register.subject)`, the same predicate the register handler uses.
- **One call per panel open, inside `/api/student`.** The panel already makes one
  Portal call for that roll number (ADR 0018); this is a second inside the same
  request, over that register's own range. Nothing is added to a load.
- **The wire names are lower-cased**, and that is not cosmetic: this method's
  proxy declares `rollNo`, `sectionId`, `studentName`, `fromdate`, `todate` where
  the subject register's declares `SubjectId`, `Section`, `FromDate`-style names.
  Sending the sibling's names is not an empty report — it is
  `Object of type 'System.DBNull' cannot be converted to type 'System.String'`.
- **The dates are the union over subjects, in the grid's own order.**
  `parseStudentAbsences` reads the `A` cells under their own date headers, with a
  date absent if any subject's cell for it says so — the cell holds one mark per
  period, so any `A` in it is that date missed. That is what the panel shows: the
  flat list a subject register also shows, not a subject-by-subject table.
- **A report ECAP will not give changes nothing.** The panel's GPA and numbers are
  the main read; a 502 on the grid leaves the dates out rather than failing the
  panel or claiming no absences, and a 401 still ends the session. A reply that is
  not that report is `null`, which is not a clean sheet — the list is left off.

## Consequences

- **The All subjects panel now answers a question it could not before**, at the
  cost of one more Portal call on the open — about what the profile read already
  costs, one student at a time, only where the report on screen states nothing.
- **The subject path is untouched**: same register, same row, no second call, and
  the panel's dates still come from the row it opened.
- **The rejected shape stays available.** One register call per subject is still
  something the Portal supports, and it is what a *section-wide* day-wise view
  would need; what this ADR settles is that the panel, which is about one
  student, does not pay sixteen calls for it.
- **The two failure rules stay opposite, per screen.** On the All subjects path a
  failing class report is a named 502, because there it *is* the register; a
  failing student grid is not, because it is not.
