# 04: A subject that fails renders its row, not a gap

**What to build:** When one Subject's register cannot be read, that Subject still
appears and says so, and the other rows read normally. A row that is present but
unreadable is a different fact from a Subject that is not there, and the two must
not look alike — a silently missing row reads as a Subject with no problems.

**Blocked by:** 03 — The saved section's subjects, one row each.

**Status:** ready-for-agent

- [ ] A Subject whose register failed keeps its row, with a dash for each of the
      four figures.
- [ ] A Subject absent from the Section produces no row. Present-but-unreadable
      and not-there must not look the same on screen.
- [ ] A visit that returns nothing shows nothing. No figure from a previous visit
      survives on screen.
- [ ] Overlapping visits do not interleave. The newer visit wins, and the older
      one stops rather than writing over it.
- [ ] A session that has expired partway through signs out with a reason the
      faculty member can read, rather than leaving a screen of dashes.
- [ ] A failing Class attendance report never fails the whole dashboard. It is
      allowed to fail on the Subject path; on the All subjects path it is the
      subject, and an empty one is a named error rather than a silent blank.
- [ ] One slow Subject does not hold back the rows that have already arrived.
