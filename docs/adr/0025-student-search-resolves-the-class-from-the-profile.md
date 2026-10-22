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
  more than one option names none of them; a missing course/branch/semester is a
  named answer, not a picked default.
- The window is what the client sends (the range the app opens at), and is named
  in the panel.
- A register is read only by a deliberate ask: Load register, or Find student.
  Never by a refresh, never by a mount.
- Absent dates are not read for a searched student (no Student Wise call); the
  drawer shows only the figure the report states.
- A roll in no section keeps its profile and says so, rather than failing.
- The drawer reuses `StudentDetails`: the register-only sections (figures) render
  only when a row exists, the profile sections always render.

## Consequences
- One extra route and one client module; the server seam gains `handleFind`,
  tested over the fake portal like `handleRegister`.
- The profile page's real shape is unknown to us: the parser is generic and the
  panel prints exactly what it read, so a wrong class is visible rather than
  silent. If the page states no class at all, the tab degrades to profile-only.
- No new icon library, no new CSS: the rail button uses Phosphor `MagnifyingGlass`.
