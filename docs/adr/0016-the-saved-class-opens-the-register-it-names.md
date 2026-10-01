# 0016 - The saved class opens the register it names

Date: 2026-09-29. **Amended 2026-10-01**, twice over, and both amendments reversed
the Decision below rather than adding to it. What is here now is what the code
does; the reasoning it overturned is kept, because it is the reason the current
shape is a deliberate trade and not an oversight.

Builds on ADR 0009 (routes, not a mode switch) and ADR 0015 (the selection left
the URL). Touches ADR 0014 (the vault) and repairs a gap it left.

## Status

Accepted, amended

## Context

Every session began the same way: sign in, wait for the cascade to fill, pick a
subject, pick a date range, press `Load register`. For a faculty member who
wants the same class every day, that is five decisions repeated five days a
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

**A saved class is a Subject within a Section: five values, and a card that
fills the five dropdowns.** `Save this class` stores course, semester, branch,
section and subject — no labels, and no dates. Clicking a card fills all five
and reads nothing: `Load register` stays a decision, and no register is fetched
by saving or by opening a card.

Any number of classes may be saved, one per subject taught.

### Amendment 1: the dashboard is gone

The Decision as first written made `/dashboard` the saved section, one row per
subject in it, each with Students, class average and the two below-threshold
counts — and a `/register` page holding the picker and roster.

**That was built and then removed.** Visiting the dashboard read a register for
every subject in the section: N requests, each making two calls to the Portal, on
a screen that wanted one click and got N. It was measured only by inspection and
never against the live Portal; the ECAP session dies after 15 to 45 idle
minutes, and that fan-out was the feature's own risk.

The reason it failed is worth keeping, because it is the reason a saved class
cannot be a Section either. **A section has no statistics of its own to show.**
Every number a dashboard could have displayed is a per-subject number the
Portal states in a register, so a section-wide row is either a copy of one
subject's figures or an average across subjects — and an average across subjects
is rejected below, as unanswerable. The dashboard was a table of numbers that had
to be fetched before it could exist, for a faculty member who already knows which
subject they are about to open.

**What survived is the part that needed no Portal call:** the shortcut to the
form.

### Amendment 2: the saved unit is a Subject

The original Decision stored four values and no subject, on the argument above
that "the class" is not one thing. **That argument still holds and the decision
now contradicts it anyway.** A saved class carries its subject, so:

- Opening a card lands on that subject's register, which is the point of the
  shortcut. A saved section cannot say which register to open, and the cascade
  then chose one — landing on `ALL SUBJECTS`, the section-wide view, rather than
  the register the card was named for.
- **Three subjects in one section are three cards differing only in their last
  value.** That is the cost, stated rather than hidden: storing the subject does
  not answer the objection in Context, it moves the decision to the user, and the
  user asked for it.
- `Save this class` is disabled on `ALL SUBJECTS`, which names no register.

A class saved under the old four values carries no subject and is **dropped**
rather than offered blank — half-reading one would invent a card that reopens an
arbitrary subject.

### Freshness

There is no cached number anywhere, because there is no number on this screen.
The card shows the Portal's own labels, and they are read fresh from the cascade
rather than stored, so a subject ECAP has renamed shows under its new name.

A card's subject name is known only once the Portal has offered that section's
subjects this session. Until then the card says so rather than printing the
subject's identifier, which reads as a data fault rather than as something not
yet known. Opening the card fetches them, so the name arrives from then on.

## Consequences

- **`/api/register` is still reached only by a click.** The original Consequence
  — that the click test had to be rewritten because the dashboard made fetching
  automatic — no longer applies. `test/smoke.spec.ts` still pins it, unchanged.
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
  classes.** Deliberately, and only for those five values.
- **A shared machine shows a shared machine's class.** `localStorage` is
  per-browser, so a saved class does not follow a user to another machine.
  Scoping the key by user id stops one person's class being offered to the next;
  it does not sync. Storing it server-side would sync it and would need the same
  persistence work Q16 already requires, so the trade was taken knowingly.

### What the amendments cost, and what they fixed

Two defects shipped during this work and are worth recording, because both were
the same mistake and both are now covered by a test that was seen to fail.

**The trigger was broader than the work.** The effect that loads the dashboard
was keyed on the whole selection, so choosing a Subject re-read every subject in
the section — the N-request fan-out reached by moving a dropdown. Its comment
described the section as the trigger while its dependency list named all five
levels, and nothing reconciled the two. The rule moved out of the component into
a module importable without booting a server, which is where `resetFor` lives
now; a rule in a component cannot be tested, and an untestable rule is one that
survives the change that makes it wrong.

**A reset did not know what arrived with it.** Opening a card called the refresh
with "the section changed", which invalidates everything below it — so the saved
subject was discarded before the loop ran, and auto-fill took the first entry of
the subject list, which is `ALL SUBJECTS`. `resetFor` takes the arriving
selection: a section change that arrives carrying a subject clears nothing below
it, and one made by hand still clears the subject.

## Alternatives considered

**A dashboard of per-subject statistics.** Rejected by amendment, for the reason
above: it needs N register reads to show figures the user can get one at a time,
and the session may not survive them. It is recorded here rather than deleted
because the reasoning that killed it — a section has no statistics of its own —
also explains why a saved class must name a subject.

**One saved Subject rather than a Section.** Cheaper by one request, and it is
what the first round of design assumed. Rejected once it was clear that a
faculty member is assigned several subjects per section: saving one means
choosing 1 of 3 to see at sign-in, and the labs' smaller rosters are exactly
what a side-by-side row makes legible. **Superseded by amendment 2** — one saved
subject is now a card per subject, and the side-by-side comparison it was
rejected for is what the register page's own dropdown already provides.

**An average across the section's subjects.** Rejected as unanswerable. It would
weight a 60-student theory and a 30-student lab by roster size, report a figure
belonging to no student, and require deciding what "below 60%" means when the
two subjects disagree about who.

**Cache the last result and show it instantly.** Rejected. It trades a round trip
against a number that is silently out of date, on the one screen whose whole job
is to be believed. With the dashboard gone there is no number to cache.

**Store the full `Option` objects and skip the cascade.** Saves four requests.
Rejected: a stored label can go stale and then display the wrong class name,
which is the exact failure the line above the table exists to prevent — and the
cascade already runs on sign-in, so the requests are free.
