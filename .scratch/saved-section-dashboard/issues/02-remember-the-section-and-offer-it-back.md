# 02: Remember the section, and offer it back

**What to build:** A faculty member marks the class they teach, and the dashboard
names that class from then on, with a way to open it or forget it. Four values are
stored and nothing else: Course, Semester, Branch and Section. No Subject, and no
dates. The unit is a Section because attendance is recorded per Subject, and a
Section taught three subjects has three averages and three different denominators.

Labels are never stored. They are rebuilt from the Cascade, so a class ECAP has
renamed displays under its new name — which is the exact failure the line above
the table exists to prevent.

**Blocked by:** 01 — The signed-in name survives a restart.

**Status:** ready-for-agent

- [ ] `Save this class` becomes available once the Section is chosen. Requiring a
      Subject would disable it during the window the Cascade is still settling,
      which is when someone most wants it.
- [ ] Saving stores four values, and no Subject and no dates. A subject that stops
      being taught is one fewer row, not an orphan.
- [ ] The dashboard names the saved section after a reload, with no password
      typed, and offers to open it or to forget it.
- [ ] Forgetting it removes it, and the dashboard asks for a class again rather
      than showing a stale one.
- [ ] The saved section is offered only to the user who saved it. On a shared
      machine one person's class is never handed to the next.
- [ ] A browser that refuses storage loads normally. The app falls back to no
      saved section rather than failing to start.
- [ ] A stored section missing any of its four values is not offered, and is not
      reported as a saved class.
- [ ] Loading the register is still the only thing that fetches one. This ticket
      adds no register fetching.
