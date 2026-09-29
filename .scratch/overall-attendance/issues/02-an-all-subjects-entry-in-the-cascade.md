# 02: An "All subjects" entry in the Cascade

**What to build:** A faculty member can choose All subjects in the Subject level
and get the Section's overall attendance on its own, with no Subject register
behind it. The table becomes the class-wide list, and the Subject columns go
away, because in this state there is no Subject for them to describe.

**Blocked by:** 01 — Read the Class attendance report and show each student's
Overall %.

**Status:** ready-for-agent

- [ ] The Subject level offers an All subjects entry, and it is visually
      distinct from the Portal's own subjects so it is not loaded by accident.
- [ ] Its identifier cannot collide with a real Subject identifier. The Portal's
      own subjects keep the identifiers they had.
- [ ] Choosing All subjects and loading shows the class-wide students with the
      overall columns, and does not show Subject columns.
- [ ] No Subject register is requested in this state.
- [ ] The line naming the chosen levels reads All subjects, and never a Subject
      name, so the load in progress is unambiguous.
- [ ] Switching back to a real Subject restores today's behaviour exactly, with
      the Subject columns and the Subject-attendance figures returning.
- [ ] An expired Portal session in this state produces the same sign-in path a
      Subject register does, not a new or different error.
- [ ] The date range is honoured here too, and is named above the table as it is
      in the other state.
