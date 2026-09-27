# ECAP Attendance Dashboard

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

**Label cache**:
The per-session map from a dropdown option's value to its visible text. Required
because `ShowAcademicCalendar` wants both, and the browser only ever sends values.
_Avoid_: Option map, metadata cache

**Calling convention**:
The portal has two mutually incompatible ways of invoking a remote method, and
using the wrong one returns an empty result with no error. See `server.js`.
_Avoid_: API, endpoint style

## Attendance

**Held**:
The number of classes held in the date range, as the portal reports it.
_Avoid_: Total classes, conducted

**Regular**:
Attendance at or above 75%.
_Avoid_: Good, fine, passing

**Irregular**:
Attendance below 75% and at or above 60%. Worth a check-in.
_Avoid_: Low, at risk, deficient

**Critical**:
Attendance below 60%. Needs intervention now.
_Avoid_: Severe, failing, urgent

The three bands are the app's own thresholds and are stated once, in
`IRREGULAR_BELOW` and `CRITICAL_BELOW`. Do not introduce a fourth band without an
ADR.

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
