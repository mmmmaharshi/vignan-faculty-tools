# 0010 - Put the selection in the query string

Date: 2026-09-28

## Status

Accepted

Builds on ADR 0009, which put the screen in the URL. This puts the register's
*inputs* there too.

## Context

ADR 0009 made `/` and `/login` the answer to "which screen". The remaining
problem was that the register itself was unreachable except by clicking through
the app, and threw away on refresh:

- A refresh re-asked the portal and came back to an empty cascade, so the one
  thing a faculty member had assembled — the right section, subject and dates —
  was gone.
- A colleague could not be sent a link. "MFCS, IT, Section-1, this month" is
  four dropdowns and two date pickers of verbal instructions.

Both are the sort of thing that is invisible while you have one user and
embarrassing the first time two people use it.

## Decision

The five level identifiers and the two dates live in the query string:

```
/?course=1&semester=3&branch=6&section=1&subject=2946&from=2026-09-01&to=2026-09-28
```

- **`selectionToQuery` and `queryToSelection` are pure functions in
  `web/cascade.ts`**, so they have 7 tests that run in milliseconds with no
  browser and no portal. They are the same seam as the rest of the cascade's
  rules.
- **The URL is a snapshot, written with `replace`.** Not a history. The auto-fill
  commits `sel` several times as passes land, so `push` would leave a trail of
  half-populated cascades for Back to walk through, and walking Back through five
  dropdowns is not a thing anyone wants on a dashboard.
- **Only identifiers travel, never labels.** `ShowAcademicCalendar` needs each
  level twice — identifier and visible text — and the server can be asked for the
  text: `/api/options` returns every level with its label. A label in the URL
  would be a second copy, free to disagree with the first. ADR 0001 already
  records what happened last time a second copy of that data existed.
- **Empty values are left out entirely**, so a fresh app has no query string
  rather than `?course=&semester=&branch=`.
- **Reading is forgiving, writing is strict.** An unrecognised parameter, a
  repeated one, or a date a date input would reject is dropped rather than
  refused. The input is a URL a person can edit, and the worst a bad parameter
  can do is leave a dropdown on its default; refusing would mean a broken link
  with no way forward.

### The subject is the hard part

A subject is **never auto-filled** — it decides which register loads, so quietly
picking one risks showing a faculty member the wrong roster. ADR 0001 records
that rule and it is unchanged.

It also means the cascade *clears* the subject on every pass. So a link naming
one would land on an empty dropdown after every refresh, and the link would be
worthless to whoever it was sent to.

Replaying it is a separate step, after the passes have settled. The distinction
that matters: replaying a subject a person chose is **restoring** their choice,
where auto-filling is **making** one. A subject withdrawn since the link was
shared is not selected.

**Loading stays a click.** The link restores the selection and the dates; it does
not spend a portal round trip on every page open, and `Load register` keeps
meaning something. A shared link gets you to the same register in one click.

## Consequences

- **11 new tests.** 7 on the query-string rules in `test/cascade.spec.ts`, and 4
  browser assertions in the smoke test: every level is in the URL, the subject
  identifier is not the label, the date is, and the subject comes back on its own
  after a reload. Verified by mutation — the URL not being written, and the
  subject not being replayed, are each caught by the assertion that names them.
- **`App.tsx` gained a `useMemo` seed and two effects**, and the cascade is
  untouched. The query string is read once, at mount, and from then on written
  by the app — never read again, because tracking it in both directions is a
  loop.
- **Verified in a browser**, not only by unit tests: a link with all five levels
  and both dates, reloaded, came back with every dropdown and both date fields
  populated. A link naming `subject=99999` left the subject empty. A link with
  `?colour=blue&from=yesterday` loaded the app without complaint.

## One guard that is deliberately untested

The subject-replay effect refuses an identifier the server no longer offers. It
is **not** the thing that stops a bad subject being loaded — `chosenLevels` is
that gate, and it already refuses an unknown subject with "Choose a subject
first" however the selection got there.

Without the effect's own check, the two paths look identical on screen: Mantine
renders a value it has no option for as an empty input, and the warning comes
from the same place. An assertion here would pass with the check removed, which
is exactly the kind of test this project refuses to keep. The check stays because
`sel` should hold only what is real — re-adding a withdrawn subject later must
not silently select it — and the comment says so rather than claiming coverage.

## Alternatives considered

**Put the whole `Option` in the URL**, label and title included. Rejected: it
reintroduces the per-session label cache as a URL, with every fragility that
carried. The portal's text is fetchable; a copy of it in an address bar is not
needed to fetch it.

**Encode the selection in the path** (`/register/course/1/semester/3/...`).
Rejected as more machinery for the same payload — it makes the query string the
wrong place for `from` and `to`, which are naturally parameters, and it needs a
catch-all route for the dashboard.

**Auto-load the register when the URL names one.** Rejected, and this is the
closest call. It would make a shared link open on the register itself, which is
the most useful version of the feature. Against it: every page open then spends a
portal round trip, a slow or failing portal would put an error on screen before
the user has done anything, and `Load register` stops being a decision the user
makes. One click is the right price for that.
