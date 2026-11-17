# 03 — Presentational phases and memory

Status: resolved
Blocked by: none
Spec: `.scratch/explicit-state-machines/spec.md`

## Task

Give the presentational surfaces one phase value each, so a surface that is
neither showing data nor loading cannot be rendered.

The decisions to extract:

- The timetable surface: unread, cleared evening, and a read with periods are
  one named answer, together with the remembered day that survives a cleared
  evening. Keep the existing display rule and midnight rule exactly.
- The postings surface: loader, no classes today, and the section grid are one
  phase, with a refusal that stays in its own section and never fails the
  timetable above it. The branch default still comes from the report.
- A period box's detail: posted, not posted yet, and no class stated are one
  typed status rather than a plain string.
- The Student details boundary keeps its content through the slide-out. Model
  open, closing and closed at the boundary instead of adding another optional
  prop or second boolean. The subject-grade modal stays one nullable selection
  with its payload.
- The semester-grade modal's semester and the panel's inline mode stay separate
  decisions; do not fold navigation into the panel's lifecycle.

## Acceptance

- Each phase is a pure decision where a rule can be named; only React's own
  transient UI state remains inside components.
- Examples and properties join the existing decision and property suites;
  each property is mutation-probed and the probe is recorded.
- The home, register, student and reload browser specs stay green and
  unchanged.
- Mantine stays the only visual vocabulary. No stylesheet, CSS module or
  inline style. No change to what is rendered.

## Do not touch

The app shell, the server, the update flow, or any ADR.
