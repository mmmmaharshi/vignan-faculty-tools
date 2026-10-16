# 0018 - Read a student's profile when the panel opens

Date: 2026-10-16

## Status

Accepted

## Context

The register states what it states: for each student, an attended-of-held cell
and a percentage, for the subject and for the section. It says nothing about
their GPA or their phone numbers, because the screen it comes from
(`ShowAcademicCalendar`) does not carry them.

The Portal does have those fields. They are on a third screen, the Student
Profile page, behind its own proxy — `ShowStudentProfileNew(RollNo,
isImageDisplay)` on `StudentProfile,App_Web_studentprofile.aspx`, with
`_session=rw`. It answers for **one roll number at a time**, and the page it
returns is the student's whole bio-data: personal details, parent details,
guardian details, and a GPA line with the Portal's own credits and percentage
beside it. A live session confirmed all three figures for real students, which is
what made this decision possible at all.

So the question was not whether the data exists, but **when to ask for it**. Two
shapes were available:

- **Columns in the register**, filled by a second request that walks the section:
  every row would carry a GPA and a phone number, and the register would be shown
  once those columns were read.
- **One call for one student**, when that student's row is opened.

The spike measured the first shape's cost at roughly **478 ms per student, with
concurrency buying nothing** — about 30 seconds for a section of 69, added to
every register load, whether or not anyone looks at a student. It also required a
per-session cache to be tolerable, which is a second thing to keep right: what a
cache holds, when it is invalidated, and whose section it belonged to.

The panel's whole job is to answer a question about **one** student, asked
occasionally, by a person who is looking at that student's row. That is the shape
the Portal's method already has.

## Decision

The profile is read **when a student's panel opens, for that one student**, and
never with the register.

- Opening a row posts its roll number to `/api/student`, which goes through
  `PortalReader.studentProfile` and `ShowStudentProfileNew`. The `rw` session
  marker is a field of the remote it belongs to, not a constant inside
  `#webMethod`, because it is per method — the wrong one is a bare
  `NullReferenceException` with no parameter name in it.
- `parseStudentProfile` reads the page as a label/separator/value grid, so the
  labels are the Portal's own, and takes the GPA line as one sentence. It anchors
  on the bio-data container: a reply without it is a **502**, while a student
  whose page states `CGPA: NA` and no numbers is an **answer** the panel states
  in words. A layout change and an empty profile are different failures and are
  told apart.
- A number the page left blank is dropped rather than shown empty, and one number
  under two labels is one line.
- **Nothing is computed.** The percentage beside the CGPA is the Portal's own
  figure, exactly as the attendance columns are, and the CGPA is not derived from
  the credits.
- A 401 still means the session is gone, so the panel does not invent its own
  expiry rule; a 502 shows in the panel and signs nobody out.

## Consequences

- **The register stays one request.** Opening a panel does not slow a load, and a
  load never fails because a profile could not be read.
- **A panel open costs about half a second**, spent on the student that was
  actually asked about. Opening twenty rows is twenty calls, on purpose: no
  cache, because caching is the part of the rejected shape that needed
  maintaining. If that ever hurts, the cache is the thing to add, and this ADR is
  where to say so.
- **The panel's second half arrives after its first.** The attendance figures
  come from the row already on screen, so they never wait; the GPA and numbers
  show a reading line until they land.
- **A slower read cannot land under the wrong name.** The open row carries a
  token, the way `refreshToken` does for a register load, so a reply for a panel
  that has been closed or replaced is dropped.
- **The rejected shape is not forbidden forever.** Columns in the register are
  still a shape the Portal supports; what this ADR settles is that they are not
  worth 30 seconds of every load.
