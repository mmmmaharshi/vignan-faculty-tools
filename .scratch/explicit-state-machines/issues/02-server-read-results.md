# 02 — Server read results

Status: resolved
Blocked by: none
Spec: `.scratch/explicit-state-machines/spec.md`

## Task

Replace the nullable pairs, loop flags and reason strings in the server's read
results with named outcomes that each handler narrows once.

The decisions to extract:

- The full-semester absences walk: an unparseable request, a mid-walk refusal
  with a partial list, a dateless month that stopped the walk early, and a walk
  that reached the twelve-month cap are four distinct outcomes.
- The section scan in Student Search: no section answered, some answered but no
  row, the row found, and every section refused are four distinct outcomes.
- The class resolver: a resolved class and a human reason for no class, with the
  inferred-semester flag tied to the branch that set it.
- The liveness guard: whether this call actually touched ECAP, so a dead Session
  cannot be answered as 200 by a caller that skipped the probe.
- The backlog reader's cell cursor: the two states of "next cell is a semester
  header" and "next cell is that semester's subject" are one decision.

## Acceptance

- Every outcome is an explicit type narrowed at the handler boundary.
- Examples and properties join the existing decision and property suites;
  each property is mutation-probed and the probe is recorded.
- The route specs for student, register, options, today and semstart stay green
  and unchanged.
- No Portal call, calling convention, session marker, HTTP status or wire shape
  changes.

## Do not touch

The app shell, the presentational panels, the update flow, or any ADR.
