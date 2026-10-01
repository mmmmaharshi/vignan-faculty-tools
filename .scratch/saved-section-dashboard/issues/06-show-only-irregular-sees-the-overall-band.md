# 06: Show only irregular sees the overall band

**What to build:** On a Subject register, a student who is healthy in that Subject
but Critical overall is currently filtered out by `Show only irregular`, because
the filter reads the Subject band whatever the table is showing. That is the
student the overall feature was built to catch, and the filter hides them. The
filter reads whichever band the table is actually displaying, as it already does
on the All subjects path.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] On a Subject register, a student who is Regular in that Subject but Critical
      overall is kept by `Show only irregular`.
- [ ] The filter reads the band the table is showing: the overall band on the All
      subjects path, the Subject band on a Subject path.
- [ ] Sorting, the row tint and the badges are unchanged. The tint is driven by the
      Subject bands, and the overall figure does not recolour a row on its own.
- [ ] The boundary behaviour is unchanged: a percentage exactly at a threshold is
      not below it, and neither threshold moves.
- [ ] This is a change to what the filter keeps, so it is stated as a fix and not
      as a new option. There is no setting to turn it back.
