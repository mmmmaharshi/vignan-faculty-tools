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
The panel a register row opens: that row's own figures, then the GPA, semesters
and phone numbers ECAP states for the one student. The figures are the row already
on screen; the GPA, semesters and numbers are one Portal call for that roll
number, made when the panel opens rather than with the register, because the
Portal answers for one student at a time. Not the same thing as **Profile**, which
is the rail's screen about the signed-in user's own session. See
`docs/adr/0018-read-a-students-profile-when-the-panel-opens.md`.
_Avoid_: Profile page, student profile, sidebar

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

## Identity

**Sign-in**:
Exchanging an ECAP user name and password for a portal session, held as the
`frmAuth` cookie. The password is used to sign in to ECAP and is kept in the OS
credential vault (or, where `Bun.secrets` is absent, the gitignored plaintext dev
file), so
the app can sign in again when the portal's own session expires; it never reaches
the browser and is never logged. See ADR 0019.
_Avoid_: Login, authentication, auth

**Session**:
One signed-in user's portal cookie jar on the server. Separate per user, so two
people can be signed in at once.
_Avoid_: Jar, cookie store

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
