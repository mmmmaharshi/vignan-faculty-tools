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

**Option**:
One entry in a level's dropdown: the identifier, the visible text, and the
portal's own `title` attribute. `ShowAcademicCalendar` needs the first two of
those for every level, so a chosen level travels whole rather than as a bare
value.
_Avoid_: Choice, entry, item

**Calling convention**:
The portal has two mutually incompatible ways of invoking a remote method, and
using the wrong one returns an empty result with no error. See `server.ts`.
_Avoid_: API, endpoint style

## Attendance

**Attended of held**:
The portal's combined attendance cell for one student over the whole date
range: a string such as `38/45`. The app displays it and never parses it, so
the two numbers inside it are not separately modelled and must not be reasoned
about as if they were.
_Avoid_: Held, total classes, conducted, attendance

**Regular**:
Attendance at or above 75%.
_Avoid_: Good, fine, passing

**Irregular**:
Attendance below 75% and at or above 60%. Worth a check-in.
_Avoid_: Low, at risk, deficient

**Critical**:
Attendance below 60%. Needs intervention now.
_Avoid_: Severe, failing, urgent

The three bands are the app's own thresholds, stated once in
`attendance-bands.ts` as `IRREGULAR_BELOW` and `CRITICAL_BELOW` and applied by
`band(pct)` in that same module. Both are "below", so there is no overlap and no
gap: 75 is Regular, 74.99 is Irregular, 60 is Irregular, 59.99 is Critical. Do not
introduce a fourth band without an ADR.

A percentage the portal would not give is in no band at all: not Regular, not
Irregular, not Critical. It is not evidence of bad attendance, so it is left out
of the class average rather than counted as zero, and the row still appears in the
register and the total.

The flags on a row and the counts in the summary come from one pass in
`summarise`, so they cannot disagree. See
`docs/adr/0006-give-the-attendance-bands-a-module.md`.

## Identity

**Sign-in**:
Exchanging an ECAP user name and password for a portal session, held as the
`frmAuth` cookie. The password is used once, to encrypt the login payload, and is
never stored.
_Avoid_: Login, authentication, auth

**Session**:
One signed-in user's portal cookie jar on the server. Separate per user, so two
people can be signed in at once.
_Avoid_: Jar, cookie store

## Vocabulary to watch

**Subject**:
A course the signed-in user actually teaches, as ECAP lists it. The portal calls
these things both "subject" and "subject type" in the same record; the value is
the identifier, the title is the teaching type.
_Avoid_: Course, paper, class

**Course**:
The programme, not the subject. B.Tech is a course; MFCS is a subject. Conflating
these is the single easiest way to misread a register.
_Avoid_: Programme, branch
