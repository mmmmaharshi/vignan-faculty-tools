# The Portal's wire contract

One row per remote the app calls. **Read a row before writing a call; measure a
row before trusting it.** ECAP answers a wrong parameter name with an empty
result or a bare exception, never with a helpful error, so a guessed contract
looks like "no data".

Re-measure a row with `bun scripts/portal-probe.ts <method>`, which prints the
proxy's own declaration — the only place a contract exists.

All generated-proxy calls are `POST` to `<proxy>?_method=<name>&_session=<marker>`
with a body of `key=value` lines joined by `\r\n`, `%` escaped to `%26` and `=`
to `%3D` (`webMethodBody`). `_session` is per method: the wrong marker is a bare
`NullReferenceException` with no parameter name in it.

## Generation of the register family

- Proxy: `/vignanit/ajax/Academics_AcademicRegister,App_Web_academicregister.aspx.a2a1b31c.ashx`
- Page: `/vignanit/ACADEMICS/AcademicRegister.aspx?scrid=335`
- The proxy's own served copy lists **only the methods the signed-in account may
  call** (five for a faculty account), so a method "missing" from it is about
  permissions, not about the method.

| Method | `_session` | Parameters, in declared order | Reply |
| --- | --- | --- | --- |
| `ShowAcademicCalendar` | `no` | `SubjectId, Section, Course, CourseName, Branch, BranchName, Semester, SemesterName, SubjectShortCode, SubjectType, AllowPrint, fromdate, todate` | The subject register: header row, one row per roll |
| `ShowAcademicCalendar_StudentWise` | `no` | `rollNo, sectionId, courseId, courseName, branchId, branchName, semesterId, semesterName, studentName, allowPrint, fromdate, todate` | One student, one row per subject, one column per day |
| `ShowAcademicCalendar_StudentWise_Cumulative` | `no` | same twelve as StudentWise, **lower-cased** | One student, one row per **day**, one cell per period, colour-coded; totals printed as empty spans |
| `FillSubjects` | `no` | `CourseId, BranchId, SemesterId` | `<option>` list |
| `FillStudents` | `no` | `CourseId, BranchId, SemesterId, **Section**` | A quoted JS string holding `<select id='ddlStudent'>` |

Traps measured here:

- **`Section`, not `SectionId`.** The fourth argument of `FillStudents` is the
  only one not named `…Id`; sending `SectionId` answers an empty list.
- **Replies can be a quoted JS string.** `FillStudents` arrives as
  `'<select …\'ddlStudent\'…>'`; run `unquoteJs` before parsing, or every
  attribute carries a backslash.
- **The register window is the user's, the semester window is not.** The
  reports take any range, but a start before the semester is silently clamped
  to the semester start and echoed with the **current** year, so a report's own
  `Date Range` is not a trustworthy echo of what was asked.
- **Cumulative totals are not stated.** `Total Held/Attend/Absent` arrive as
  `<span id="spnheld">` and siblings with nothing inside; the page fills them
  from the grid. Count the grid's cells by the legend the reply carries — see
  ADR 0026.

## Other remotes

| Remote | Marker | Notes |
| --- | --- | --- |
| `LoadCourses`, `LoadBranchAndSemestersDropDown`, `LoadBranchSections` | jQuery convention (`jqmethods.aspx`) | Not the proxy convention; branch/semester arrive as one reply's two halves |
| Class attendance report (`Academics_rptstudentsattendance…`) | `no` | Aggregates by subject, states counts and a percentage, never dates |
| Day-class-work report (`Academics_rptdayclasswork…`) | `no` | Branch-wide periods for one date |
| `GetToDayClasses`, `GetStudentsAttendance` | `r` | `no` answers a session-state exception |
| `GetPhotoPath` | `rw` | Faculty photo |
| `CheckEmployeeDesignation` | `r` | Faculty designation |
| `showLeaves` | `r` | Leave grid, `Leave Type \| Eligible \| Applied \| Approved \| Pending \| Declined \| Available` |
| `ShowStudentProfileNew` | `rw` | The one method that wants `rw`; wrong marker is a bare `NullReferenceException` |

## The two conventions, in one line each

- **jQuery**: `POST /vignanit/jqmethods.aspx/<Method>` with a JS-object body
  (`jqBody`) and `x-requested-with: XMLHttpRequest`.
- **Generated proxy**: as above. Reaching a proxy-only method through jQuery
  answers a generic 500 while other methods on that endpoint still work.
