# 01 — App Session and dashboard lifecycles

Status: resolved
Blocked by: none
Spec: `.scratch/explicit-state-machines/spec.md`

## Task

Model the four remaining lifecycle decisions in the app shell as explicit pure
modules, and reduce the shell to applying those decisions.

The decisions to extract:

- The end of a Session. One named reason replaces the empty-string sentinel;
  one writer owns the hand-over; the policies for which reasons show a note and
  which reasons keep the stored credential are stated in one readable place.
  Preserve the boot rule that keeps the credential when a probe never answered.
- The one-shot load snap. An armed/consumed decision with one owner replaces the
  boolean ref, so a hand-typed range edit and a finished Register load cannot
  race to disarm it.
- The cascade run. A named lifecycle distinguishes no run, the current run, a
  superseded run, and a failed run that kept partial Options. A superseded run
  asks the Portal nothing further.
- The Student Search result. A named outcome distinguishes a refusal, an
  unstated class, a class without the roll, and a class with the roll. No wire
  shape changes.

## Acceptance

- Every extracted decision is a pure module importable without booting a server.
- Examples and properties live in the existing decision and property-state
  suites; each property is mutation-probed and the probe is recorded.
- The session, reload, register, dates and search browser specs stay green and
  unchanged.
- No behaviour, Portal call, SWR key or wire shape changes.

## Do not touch

Another family's files, the server, the presentational panels, the update flow,
or any ADR.
