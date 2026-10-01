# 03: The saved section's subjects, one row each

**What to build:** The dashboard shows the saved Section's Subjects side by side,
so the class you actually teach is legible on sign-in without opening each Subject
in turn. One row per Subject: how many students, the class average, and how many
are below each threshold. Every number is one the Portal already returned in the
Register's own summary, so this reads what the Portal said and computes nothing.

**Blocked by:** 02 — Remember the section, and offer it back.

**Status:** ready-for-agent

- [ ] One row per Subject in the saved Section, each showing Students, Class
      average, and the two below-threshold counts.
- [ ] The two threshold columns are labelled with the app's own current
      thresholds, read from the summary the Register already returns. No number is
      written into the label, so changing a threshold moves the label with it.
- [ ] All rows share one date range, and it is the same range the register opens
      at: the remembered start when there is one, otherwise the month to date. Two
      ranges on one screen would make the rows incomparable.
- [ ] The All subjects entry is not a row of its own. It leads the Subject list,
      and counting it would count the section's students twice.
- [ ] Class average is the Portal's figure for that Subject. There is no
      section-wide average anywhere on the screen: averaging the averages would
      weight a large theory against a small lab and report a figure belonging to
      no student in either.
- [ ] Every visit refetches. No number is cached, because a student shown below
      the critical threshold last week may not be there now, and someone acts on
      it.
- [ ] A Subject whose figures have not arrived shows no figure rather than the
      previous visit's.
- [ ] A Subject ECAP has stopped teaching is one fewer row. It is never dropped
      silently and never carried over from a previous visit.
- [ ] A section with no saved choice asks for a class and shows no rows.
