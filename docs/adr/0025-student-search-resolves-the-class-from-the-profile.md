# ADR 0025 — Student Search resolves the class from the profile

## Status
Accepted.

## Context
A faculty member wants attendance for one roll number without first picking the
class. ECAP has no roll-only attendance endpoint: `ShowAllAttendance` needs the
five levels, and `ShowAcademicCalendar_StudentWise` needs them too. The only
ECAP answer a roll number alone is enough for is the StudentProfile page, which
states GPA, SGPAs, phone numbers and backlogs.

## Decision
The `/search` screen asks `/api/find` with `{ roll, from, to }`. The server
reads the profile page, parses the bio-data `Label : Value` rows into a
`StatedClass`, matches each stated value to the Portal's own `Option`s (value
first, then label, then the label without its kind word), and — when all of
course, branch and semester resolve — reads the class attendance report for each
candidate section (one when the page states it, all of them otherwise), stopping
at the first that holds the roll. The reply carries the profile, the resolved
class, the window and the register row.

Rules:
- The class comes from the page, never from a guess. A stated value that names
  more than one option names none of them; a missing course or branch is a
  named answer, not a picked default. A missing semester is inferred from the
  SGPAs the page states (the highest completed, plus one) and named in the
  panel's class line; with no SGPAs at all it is refused rather than guessed.
  A missing section loops every section of that class.
- The figure stays over the asked month, which the panel names. Beside it, the
  full-semester absent list walks the section's Student Wise grid back one
  month at a time — single-month windows are the only shape used, so no range
  wider than a month is ever asked and no calendar month is assumed — unioned
  oldest-first, stopping at the first month with no meeting days. A month ECAP
  will not give ends the walk with a warning, never a silent partial list.
- A register is read only by a deliberate ask: Load register, or Find student.
  Never by a refresh, never by a mount.
- The absences come from the student's own Student Wise grid — the class report
  states no dates, so the grid is the only place they exist: once over the
  asked month, and once per month on the walk beside it.
- A roll in no section keeps its profile and says so, rather than failing.
- The panel reuses `StudentDetails`, rendered inline below the form: the
  register-only sections (figures) render only when a row exists, the profile
  sections always render.

## Consequences
- One extra route and one client module; the server seam gains `handleFind`,
  tested over the fake portal like `handleRegister`.
- The profile page's real shape is unknown to us: the parser is generic and the
  panel prints exactly what it read, so a wrong class is visible rather than
  silent. If the page states no class at all, the tab degrades to profile-only.
- No new icon library, no new CSS: the rail button uses Phosphor `MagnifyingGlass`.
