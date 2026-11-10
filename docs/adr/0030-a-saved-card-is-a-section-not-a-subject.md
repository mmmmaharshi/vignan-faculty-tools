# 0030 - A saved card is a section, not a subject

Date: 2026-11-10
Status: Accepted

## Context

ADR 0016 saved a class — one Subject within a Section — and a later amendment
made it one card per subject taught, on the grounds that was what the user asked
for. The cost of that amendment was visible on the screen: three subjects in one
section were three cards differing only in their last value, and each card's
subject name had to be cached, because the Portal answers subjects one section at
a time and a card naming another section had no label until it was opened. That
cache needed a key of `section + subject` to stop one section's subject name
being handed to another's.

What the faculty member actually does is work a section. The subject is a way of
narrowing a register that has already been read, not the thing being saved — so
the subject-specific card was extra choices for the same destination, and the
name cache existed only to label a distinction the user did not want.

## Decision

A card saves the four values that name a section: course, semester, branch and
section. Opening one fills those four and sets the subject to `ALL SUBJECTS`, so
the register it lands on is the section-wide one and the user narrows from there.

- The stored shape keeps the `subject` key, always `ALL SUBJECTS`, so a card
  written under the old rule still reads as the section it belongs to and the
  five-value key stays one shape. The stored subject is never read back.
- The subject-name cache goes with the subject: there is no per-card subject name
  left to keep, so the cascade run no longer collects the names it was offered and
  `subjectNameKey` no longer exists.
- `Save this section` is enabled once the four levels are chosen. The subject on
  screen is irrelevant to whether a section can be saved.
- A save missing any of the four is dropped rather than offered blank.

## Consequences

- One card per section, which is what the user asked for. Re-saving moves it to
  the front rather than adding a second card for the same section under another
  subject.
- Three code paths and one state variable disappear with the cache: the cascade
  run's `names` map, the App-level `subjectNames` state and its three writers, and
  the key builder that guarded the collision. ADR 0016's amendment 3 is
  superseded.
- A user who wants one subject's register opens the card and picks the subject.
  That is one dropdown, in exchange for not scrolling past three cards that differ
  only in their last value.
- A card saved as one object by an even earlier build still opens: the section is
  all such an entry needs, and the missing keys are dropped on read.
