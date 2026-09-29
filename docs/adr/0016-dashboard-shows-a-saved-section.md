# 0016 - The dashboard shows a saved section, the register page shows the roster

Date: 2026-09-29

## Status

Accepted

Builds on ADR 0009 (routes, not a mode switch) and ADR 0015 (the selection left
the URL). Touches ADR 0014 (the vault) and repairs a gap it left.

## Context

Every session began the same way: sign in, wait for the cascade to fill, pick a
subject, pick a date range, press `Load register`. For a faculty member who
wants the same section every day, that is five decisions repeated five days a
week to reach a number they already know.

The request was to save the class and show its statistics on sign-in. Two facts
about the domain made the obvious design wrong.

**A faculty member teaches several subjects in one section**, and a lab carries
a smaller roster than its theory. So "the class" is not one thing.

**Attendance is recorded per subject, never per section.** `attendance-bands.ts`
computes the four numbers from the rows of exactly one subject, and
`CONTEXT.md` defines a Register as *one subject over one date range*. A section
taught three subjects has three averages, three below-75 counts and three
different denominators. There is no "class average" for a section that does not
average averages — and one that did would describe no student in any of them.

## Decision

**The saved unit is a Section, and the dashboard shows one row per subject in
it.** Four identifiers — course, semester, branch, section. No subject, and no
dates.

- **`/dashboard`** is the saved section: one row per subject, each with Students,
  Class average, Below 75%, Below 60%. All rows share one `defaultRange()`
  window, so they are comparable with each other.
- **`/register`** is where the picker and the roster live. This is the old
  dashboard, unchanged, reached by a link from the dashboard.
- `/profile` and `/login` are unchanged.

Four decisions fall out of storing a Section rather than a Subject:

1. **The subject list is free.** The portal scopes a section's subjects to the
   signed-in user, so the cascade already produces exactly the rows to show.
2. **A subject that stops being taught is not an orphan.** It is one fewer row.
   The thing that can be orphaned is the Section, and it is announced and
   offered for removal, never removed silently.
3. **Nothing new to name.** Section was already a Level. No new noun is invented
   and no existing glossary term changes meaning.
4. **Four values are stored, not five.** `Save this class` enables once the
   section is chosen, because requiring a subject would disable it during
   exactly the window — the cascade settling after sign-in — when someone most
   wants it.

### Freshness

Every visit to `/dashboard` refetches. There is no cached number anywhere.
Attendance is the one figure in this app where being stale causes harm: a
student shown below 60% last week may be at 71% now, and someone acts on it. The
`registerToken` pattern from the cascade — a newer request wins, an older one
bails — keeps overlapping visits from interleaving.

`localStorage` holds the four values and nothing else. Labels are never stored;
they are rebuilt from the cascade, so a subject ECAP has renamed displays under
its new name. The key is scoped per user id.

### One register fetch per subject

A row is one `POST /api/register`, and the cascade is shared across all of them —
one run through the levels yields every subject for the section. A partial
failure renders its own row with `—` for the four numbers rather than dropping
the row, because a row that is present-but-unreadable is a different fact from a
subject that is not there, and the two must not look alike.

## Consequences

- **`/api/register` is no longer reached only by a click.** The smoke test
  *"the click is the only way a register is ever fetched"* was written to pin ADR
  0015 and is now the opposite of the rule. It is rewritten, not deleted.
- **The user name is persisted.** The client cannot key `localStorage` without
  knowing who is signed in, and it never could after a cold load: `setUserId` is
  called in exactly two places, and neither is a restore. The ECAP user name
  becomes a fourth field on `StoredSession` and is returned by `/api/session`.
  This also repairs two things that were already broken — the header showed no
  name and the profile panel showed `—` whenever a vault-restored session loaded
  without typing a password, which ADR 0013 made the normal case.
- **`parseSession` stops being a three-field rebuild.** It returned a fresh
  object with exactly `{ id, at, cookies }`, so a fourth field would have been
  silently dropped on read. The entry grows from ~526 to ~560 bytes against the
  2560-byte per-entry cap that `test/session-store.spec.ts` already pins.
- **ADR 0015's "React state and nowhere else" is now false for the saved
  section.** Deliberately, and only for these four values.
- **A shared machine shows a shared machine's section.** `localStorage` is
  per-browser, so the saved section does not follow a user to another machine.
  Scoping the key by user id stops one person's section being offered to the
  next; it does not sync. Storing it server-side would sync it and would need the
  same persistence work Q16 already requires, so the trade was taken knowingly.

## Alternatives considered

**One saved Subject rather than a Section.** Cheaper by one request, and it is
what the first round of design assumed. Rejected once it was clear that a
faculty member is assigned several subjects per section: saving one means
choosing 1 of 3 to see at sign-in, and the labs' smaller rosters are exactly
what a side-by-side row makes legible.

**An average across the section's subjects.** Rejected as unanswerable. It would
weight a 60-student theory and a 30-student lab by roster size, report a figure
belonging to no student, and require deciding what "below 60%" means when the
two subjects disagree about who.

**Cache the last result and show it instantly.** Rejected. It trades a round trip
against a number that is silently out of date, on the one screen whose whole job
is to be believed.

**Store the full `Option` objects and skip the cascade.** Saves four requests.
Rejected: a stored label can go stale and then display the wrong class name,
which is the exact failure the line above the table exists to prevent — and the
cascade already runs on sign-in, so the requests are free.
