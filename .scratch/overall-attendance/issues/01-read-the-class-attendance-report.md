# 01: Read the Class attendance report and show each student's Overall %

**What to build:** A faculty member who picks a Course, Semester, Branch, Section
and Subject and presses Load register sees, beside each student's Subject
percentage, that student's overall percentage for the same Section over the same
date range. It comes from the Portal's Class attendance report — the screen
behind Attendance Reports → Class — which the app does not currently ask for at
all.

This is the tracer bullet: one thin path through the Portal transport, the
parser, the route handlers, the wire contract and the table. It lands a bare
number with no badge, no cards and no "All subjects", because each of those is
its own ticket and each breaks for its own reason.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Choosing a Section and a Subject and loading a register shows an Overall %
      column in the table.
- [ ] The overall percentage is the Portal's own percentage cell, shown as the
      Portal wrote it. The app performs no division, rounding or threshold
      arithmetic of its own on it.
- [ ] Students are matched to their overall figure by roll number, never by row
      position.
- [ ] A student present in the Subject register but absent from the class-wide
      report still appears in the table, shows a dash rather than a zero, and
      carries no overall flag of any kind.
- [ ] A student present in the class-wide report but absent from the Subject
      register is not added to the table. The Subject register stays the
      authority on who is in the class.
- [ ] The class-wide figure is requested over the same date range as the Subject
      register, and the range line above the table still names that range.
- [ ] If the class-wide call fails, or returns a layout the app does not
      recognise, the Subject register still renders with the overall column
      absent. A Portal problem on the new report must never remove the report
      that already worked.
- [ ] An unreadable class-wide report is distinguishable from an empty one, the
      same way the register already distinguishes them.
- [ ] Loading a register issues exactly one request to this app's register API.
      The class-wide read happens inside that one request and is not a second
      thing the front end has to trigger.
- [ ] No client-side code computes the overall percentage. It is rendered as
      received.

## Comments

**Amended 2026-10-17: the overall column is on the All subjects view, not beside a
Subject.** The first criterion above is waived. What shipped shows the overall
pair on **All subjects** alone; a subject register's table carries the Subject's
own two columns and no overall figure at all (`overallMode` in
`web/components/RegisterTable.tsx`, pinned by `test/smoke.spec.ts`). Every other
criterion here holds on both paths: the Portal's own cell as written, the join by
roll number, a dash rather than a zero, one request per load, and the failure
behaviour. The change came with the decision in `AGENTS.md` that a failing class
report must never fail the register — the subject path reads the report and
ignores it, so there is nothing there to show. See `../spec.md#amendments`.
