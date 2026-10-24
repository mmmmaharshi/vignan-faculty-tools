# Vignan Faculty Tools

The language of reading a class's attendance out of the ECAP portal, and acting on
it. Terms here are the ones the code and the portal both use; prefer them over
synonyms in issues, tests and commit messages.

## The portal

**Portal**:
The ECAP web application at webprosindia.com. A WebForms site whose Academic
Register page is a client-side shell: the server renders no dropdowns, and the
page's own JavaScript builds them by calling remote methods.
_Avoid_: The site, ECAP site, the website

**Register**:
The roster of students with per-student attendance for one subject over one date
range. Also the name of the portal page that produces it.
_Avoid_: Report, attendance sheet, class list

**Cascade**:
The dependent chain course → semester → branch → section → subject, where each
level's options are produced by the levels above it.
_Avoid_: Filters, dropdown chain, selector chain

**Level**:
One position in the cascade.
_Avoid_: Field, dropdown, step

**Section**:
A cohort of students who take their subjects together, taught through one branch
in one semester. A faculty member is normally assigned several subjects in the
same section, and a lab carries a smaller roster than its theory. The subject
list the portal returns for a section contains only the subjects the signed-in
user teaches, so a section already names its own subjects.
_Avoid_: Class, batch, division

**Option**:
One entry in a level's dropdown: the identifier, the visible text, and the
portal's own `title` attribute. `ShowAcademicCalendar` needs the first two of
those for every level, so a chosen level travels whole rather than as a bare
value.
_Avoid_: Choice, entry, item

**Calling convention**:
The portal has two mutually incompatible ways of invoking a remote method, and
using the wrong one returns an empty result with no error. See `api.ts`.
_Avoid_: API, endpoint style

## Attendance

**Attended of held**:
The portal's combined attendance cell for one student over the whole date
range: a string such as `38/45`. The app never computes with it — the two
numbers inside it are not separately modelled, and nothing is added, divided or
compared across them. The overall cell holds the same kind of string, joined
with a backslash rather than a slash, and is held to the same rule; its two
halves are shown in the Portal's own order, separated by a plain slash, so the
cell reads the way its column is named.
_Avoid_: Held, total classes, conducted, attendance

**Overall attendance**:
The Portal's Section-wide attendance for one student, spanning every subject in
the Section over one date range. It comes from the Portal's Class attendance
report and is stated by the Portal as a combined cell and a percentage, both of
which are displayed as written. It is a second figure beside the Subject one,
never a replacement for it: the two are banded independently and either can be
the reason to act.
_Avoid_: Cumulative, total attendance, aggregate

**All subjects**:
The extra entry in the Subject level that asks for every subject in the Section
at once. It is not a Portal subject and its identifier is not a Portal
identifier, so it can never collide with one. It leads the list and is
upper-cased, so it reads as a mode rather than as one of the Portal's own short
codes. Choosing it loads the class report alone and leaves no Subject register
behind, which is why the Subject columns disappear in that state.
_Avoid_: Overall view, aggregate subject, everything

**Regular**:
Attendance at or above 75%.
_Avoid_: Good, fine, passing

**Irregular**:
Attendance below 75% and at or above 65%. Worth a check-in.
_Avoid_: Low, at risk, deficient

**Critical**:
Attendance below 65%. Needs intervention now.
_Avoid_: Severe, failing, urgent

The three bands are the app's own thresholds, stated once in
`attendance-bands.ts` as `IRREGULAR_BELOW` and `CRITICAL_BELOW` and applied by
`band(pct)` in that same module. Both are "below", so there is no overlap and no
gap: 75 is Regular, 74.99 is Irregular, 65 is Irregular, 64.99 is Critical. Do not
introduce a fourth band without an ADR.

A percentage the portal would not give is in no band at all: not Regular, not
Irregular, not Critical. It is not evidence of bad attendance, so it is left out
of the class average rather than counted as zero, and the row still appears in the
register and the total.

The flags on a row and the counts in the summary come from one pass in
`summarise`, so they cannot disagree. See
`docs/adr/0006-give-the-attendance-bands-a-module.md`.

## The student

**Student details**:
The panel a register row opens: that row's own figures, the dates the Portal says
that student missed, and the GPA, semesters, phone numbers and backlogs ECAP
states for the one student. The figures are the row already on screen; the
absences are one list — the full semester's. The
Portal states only the days a window covers, so the panel reads the same read
again over the remembered semester start whenever the window starts after it;
when the window already is the whole semester, its own dates are shown as the
one list and no wider read is asked. The
GPA, semesters and numbers are one Portal call for that roll number, made when
the panel opens rather than with the register, because the Portal answers for one
student at a time. On the **All subjects** view, whose report aggregates by
subject and states no dates at all, that one call is joined by a second — the
**Student Wise report** for the same roll number over the same range — because
there the dates exist nowhere else. The wider read is a third call, over the
remembered start, and only when the window starts after it. Not the same thing
as **Profile**, which is the navigation's screen about the signed-in user's own
session. See `docs/adr/0018-read-a-students-profile-when-the-panel-opens.md`,
`docs/adr/0021-the-all-subjects-panel-asks-for-one-students-grid.md` and
`docs/adr/0022-the-all-subjects-view-probes-one-subject-for-its-start.md`.
_Avoid_: Profile page, student profile, sidebar

**Absent dates**:
The dates a Portal grid says `A` for one student, in that grid's own date order —
read, never a count subtracted from a calendar. A subject register states them in
the row that was opened; the All subjects report states none, so there the panel
reads that one student's own **Student Wise report** instead
(ADR 0021). A grid that states no dates leaves the list off rather than reading
as a clean sheet, and so does a student a wider grid never mentions.
_Avoid_: Missed days, absent count, leave

**Student Wise report**:
ECAP's own report for one roll number across every subject of the section —
`ShowAcademicCalendar_StudentWise` on the register's own proxy, one row per
subject and one column per day the section met. It is the only Portal answer
that carries per-day data for a whole section at once, and its wire names are
lower-cased, unlike the subject register's. Its Cumulative sibling states no
dates.
_Avoid_: Student report, per-student register, day-wise report

**GPA**:
The Portal's own line for one student — `CGPA: 5.61   Credits:16/19   48.55 %` —
printed as written. `NA` is the Portal's answer for a student with no past
semesters, and it is not a zero. Nothing here is computed from the credits.
_Avoid_: Marks, grade, score

**SGPA**:
The Portal's own per-semester figure, one line under the CGPA and named by the
semester above it (`I Semester   5.61`). It is read from the per-semester grid by
the column that grid heads `SGPA`, never from the end of the row — the Portal
leaves that row unclosed, so its last cell is the credit total, not the GPA. A
student with no past semesters has no SGPA rather than a zero.
_Avoid_: Semester GPA, grade point average, `SGPS`

**Phone numbers**:
The numbers the Portal's StudentProfile page filled in for a student, under the
Portal's own labels (`Mobile.No`, `Father Mobile.No`). A label it left blank is
not shown at all, because a blank field is not a number the app knows.
_Avoid_: Contact, guardian details

**Backlogs**:
The subjects the Portal's StudentProfile page lists under its own `BACKLOGS`
heading, by semester, with the page's own `Total backlogs` line. The page marks
some of them in red with an asterisk and says nowhere what the mark means, so it
is shown as written and not explained. A page with no backlogs says so in words on
one build (`Student have no backlogs`) and leaves the section empty on another: the
words are shown, because a stated absence is an answer, and a page that says
nothing about them gets no section at all.
_Avoid_: Arrears, supplementary exams, failed subjects

**Student Search**:
The navigation's third screen: one roll number in, the class ECAP's profile page puts
that student in, the row that class's own report holds for them (attendance and
band), and the GPA, semesters, phone numbers and backlogs ECAP states for them.
The class is read from the student's own page rather than picked, so a student
not in the class still gets their profile, and a class the page names but the
Portal's lists do not offer is a named answer rather than a guess. The attendance
figure covers the window the app opens at, which the panel names. It reads a
register through a deliberate ask, never through the cascade's refresh loop. See
ADR 0025.
_Avoid_: Find student, lookup, search student

**Home**:
The navigation's first screen and the landing screen: today's own timetable
for the signed-in faculty member — time, subject, and section as the grid
writes them (it states no room) — read off the faculty dashboard's schedule
grid when Home is opened, and refreshed behind the cached answer on return.
An empty day shows one row reading No Classes Today — which is also what
ECAP answers after ~4pm, when it clears the day. See ADR 0027.
_Avoid_: Dashboard, landing page, homepage

**Today's classes**:
ECAP's own answer to what the signed-in faculty member teaches today:
`GetToDayClasses` on the faculty dashboard's proxy, no parameters, taking the
`r` session marker the proxy declares. It answers an HTML fragment for the
`tblschedule` grid, which has no header row: period and time in the first
cell, subject over section in the second. An `<hr/>` stacks a second subject
under the first; an empty second cell is a free period and is left out. The
grid states no room. The cleared-evening fragment is a bare `</table>`, which
is an empty day rather than a failure. See ADR 0027.
_Avoid_: Schedule, periods, routine

**Attendance Not Posted**:
Whether the day's periods got their attendance, from the day-class-work
report (`ShowDayClassWork`, `_session=no`): one branch after another, each
pending period with its section and the staff it waits on — a fully posted
branch reads as one line. Read when Home opens, below the timetable; a
refusal stays in its own section and never fails the table above it. No
classes that day is a different answer from all posted. See ADR 0028.
_Avoid_: Pending attendance, unmarked periods

## Identity

**Sign-in**:
Exchanging an ECAP user name and password for a portal session, held as the
`frmAuth` cookie. The password is used to sign in to ECAP and is kept in the
browser's localStorage with the session, so
the server can sign in again when the portal's own session expires; it is never
logged. See ADR 0024.
_Avoid_: Login, authentication, auth

**Session**:
One signed-in user's portal cookie jar, kept in the browser's localStorage and
sent on every request — the server holds nothing per user, so two people can be
signed in at once from anywhere. See ADR 0024.
_Avoid_: Jar, cookie store

**Leave counts**:
The `Eligible`, `Applied`, `Approved`, `Pending`, `Declined` and `Available`
figures ECAP's ACADEMICS → LEAVES → APPLY-SELF page states for the signed-in
faculty member, one row per leave type. They are read with the profile and
shown as the grid writes them; nothing is recomputed from them. A reply
without that grid is no figures, not all zeros.
_Avoid_: Leave balances, time off, leave requests

## Vocabulary to watch

**Subject**:
A course the signed-in user actually teaches, as ECAP lists it. The portal calls
these things both "subject" and "subject type" in the same record; the value is
the identifier, the title is the teaching type. Attendance is recorded per
subject, so two subjects in one section have different rosters and different
percentages. The Portal's Class attendance report does give one figure spanning
every subject — that is **overall attendance**, and it is a different fact from
any Subject's own.
_Avoid_: Course, paper, class

**Course**:
The programme, not the subject. B.Tech is a course; MFCS is a subject. Conflating
these is the single easiest way to misread a register.
_Avoid_: Programme, branch
