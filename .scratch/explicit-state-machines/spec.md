# Spec: make every implicit state machine explicit

Status: ready-for-agent

## Problem Statement

The app gives the right answers today, but the same class of defect keeps
reappearing in a new place. A Sign-out that forgets the previous faculty
member's Register; a Student details read that fires for a panel already
sliding out; a Load register click that takes the month window before the
semester start is known; a redirect loop that presents as a page which never
finishes loading. Each was fixed, and each fix was a small decision buried in
an effect, a boolean ref, or a `null` that could mean several things.

From the faculty member's side, the cost is trust: a change to the picker, the
panel or the Session can silently bring back a bug they have already reported.
From the maintainer's side, the cost is a debugging session that begins by
reconstructing a lifecycle from five call sites. From an agent's side, the cost
is the same reconstruction on every task, with no single place that says which
states are legal.

Four lifecycles have already been given explicit models — the Session view, the
student panel, the Load gate and the route guard — and the boot decision was
just added. Everything else that holds a phase is still implicit.

## Solution

Give each remaining lifecycle one explicit model in one small pure module: a
discriminated union with named states, a transition function where there is a
sequence, and predicates where a caller needs to ask a question. The caller
applies the decision and owns no phase of its own.

No behaviour changes. The Portal is still read through the same methods, the
Register is still fetched only by Load register, the Session still lives in the
browser and slides back on every answer, SWR keys still carry the epoch, and
every figure the app states is still read rather than computed. The work is a
change to the shape of the app's own decisions, not to what the app says.

Each model is pinned at the one existing seam: pure decision modules tested
directly, with properties for the rules examples cannot reach. The existing
browser and route specs are the regression gate that proves nothing a faculty
member can observe has moved.

## User Stories

1. As a faculty member, I want a Session that always forgets my predecessor's Register when it ends, so that I never open someone else's students.
2. As a faculty member, I want the reason my Session ended to decide whether I see a message, so that an empty alert never appears under the sign-in form.
3. As a faculty member, I want a deliberate Sign-out to be silent, so that leaving for the day is not reported as a fault.
4. As a faculty member, I want an expired Session to say so, so that I understand why I am looking at the sign-in form again.
5. As a faculty member, I want a Portal that did not answer to say so, so that I know the form is a fallback and my stored Session may still work.
6. As a faculty member, I want my stored credential kept when the boot probe fails, so that a transport failure does not sign me out of a Session that is still good.
7. As a faculty member, I want the same hand-over however my Session ended, so that no path skips the sweep that clears the stored view.
8. As a faculty member, I want the boot probe asked at most twice, so that a dead Portal cannot keep my browser busy.
9. As a faculty member, I want the name in the rail to arrive with a restored Session, so that I never see a dash for a Session that works.
10. As a faculty member, I want a restored Session to land on Home, so that a reload does not leave me on an unknown path.
11. As a faculty member, I want a signed-in visit to the sign-in path sent back to the app, so that Back never shows me a form I cannot use.
12. As a faculty member, I want a Register that starts where its own grid starts, so that the From input says the same thing as the table.
13. As a faculty member, I want a hand-typed From to survive the load that follows it, so that a stale Reply cannot overwrite a date I chose.
14. As a faculty member, I want a refused Load register to leave From alone, so that a failed click does not snap my dates back.
15. As a faculty member, I want editing To alone to leave From unsettled, so that the semester-start walk still settles my window.
16. As a faculty member, I want the Load button disabled while the semester start is being found, so that my first click cannot take the month window.
17. As a faculty member, I want a remembered semester start to open From with no Portal call, so that returning to a known Section is immediate.
18. As a faculty member, I want the cascade refresh stopped when I change a Level, so that an older answer cannot overwrite the class I just picked.
19. As a faculty member, I want a failed cascade pass to keep the Options that already arrived, so that I do not start over from an empty picker.
20. As a faculty member, I want Try again to re-settle from the selection on screen, so that an Options failure is not a dead end.
21. As a faculty member, I want a superseded cascade run to ask the Portal nothing further, so that a discarded choice spends no round trips.
22. As a faculty member, I want the class report and the subject columns read together, so that a Register answers in one request.
23. As a faculty member, I want a 401 from any read to end the Session, so that no screen keeps showing numbers from a Session ECAP has refused.
24. As a faculty member, I want a 502 to leave me signed in, so that an ambiguous failure is not treated as expiry.
25. As a faculty member, I want Student details to keep their content through the slide-out, so that the panel does not go empty while it is closing.
26. As a faculty member, I want a wider absent-dates read only for a panel that is open, so that a Register loaded during the slide-out reads nothing.
27. As a faculty member, I want one absent list in Student details, so that window dates and semester dates are never shown as two answers.
28. As a faculty member, I want a roll number in Student Search to state the class and window its figures belong to, so that a percentage is never read without its period.
29. As a faculty member, I want a roll in no Section of that class to keep its profile and say so, so that a missing row is an answer rather than a blank screen.
30. As a faculty member, I want a class the Portal's lists do not offer named rather than guessed, so that I can tell an inferred semester from a stated one.
31. As a faculty member, I want the All subjects view to show each Subject's own percentage, so that I can judge one Subject without leaving the Section-wide Register.
32. As a faculty member, I want a Subject column the Portal did not offer dropped, so that no invented column narrows my worklist.
33. As a faculty member, I want ticked column bars to intersect with the standing bars, so that the strictest filter wins.
34. As a faculty member, I want a student with no stated percentage sorted last, so that an absence of evidence does not send me after the wrong student.
35. As a faculty member, I want the Register in the Portal's own roster order until I tick a bar, so that it reads as a roster rather than a league table.
36. As a faculty member, I want a search typed for one class cleared when the next Register loads, so that a hidden filter does not look like an empty class.
37. As a faculty member, I want the ticked bars kept between classes, so that a standing intent travels with me.
38. As a faculty member, I want Home to keep the timetable it read that morning when ECAP clears the evening, so that I can still see my periods after four.
39. As a faculty member, I want a cleared day to name every slot, so that a free period reads as No Classes Today rather than as missing data.
40. As a faculty member, I want Attendance Not Posted to distinguish no classes today from all posted, so that the two answers are not confused.
41. As a faculty member, I want a branch picker whose default is the first branch the report names, so that the section grid is always showing something real.
42. As a faculty member, I want a period box to open onto the class it belongs to, so that subject and staff travel with the box.
43. As a faculty member, I want a free period to say no class was stated, so that an empty room is not reported as an unposted class.
44. As a faculty member, I want a posted period that lists no absentees to say none listed, so that an empty list is not read as a fault.
45. As a faculty member, I want a refusal in Attendance Not Posted kept in its own section, so that it never fails the timetable above it.
46. As a faculty member, I want my Leave counts shown beside my profile, so that I can see one figure per stage without recomputing anything.
47. As a faculty member, I want an offered install update to ask me before reloading, so that a background download cannot interrupt a Register I am reading.
48. As a maintainer, I want every lifecycle stated in one place with its legal states, so that I can change a rule without reading five call sites.
49. As a maintainer, I want illegal combinations unrepresentable in the type, so that a wrong state is a compile error rather than a support call.
50. As a maintainer, I want a named option instead of a boolean flag, so that a call site reads as a decision.
51. As a maintainer, I want a named reason instead of an empty string, so that the "show nothing" rule is visible at the call site.
52. As a maintainer, I want the old code path deleted in the change that retires it, so that there is one shape per behaviour.
53. As a maintainer, I want a test I have seen fail, so that a passing suite means the rule is held rather than untested.
54. As a maintainer, I want properties over examples for the rules that examples cannot reach, so that no path out of a guard exists.
55. As a maintainer, I want the existing browser and route specs to stay green, so that a structural change is provably behaviour-free.
56. As a maintainer, I want no new Portal call, SWR key or wire shape, so that the seam and the deployment stay untouched.
57. As an agent, I want a transition table I can read without running the app, so that I can name every legal state before I edit one.
58. As an agent, I want one seam for new tests, so that I do not have to choose between browser and unit tests for a decision.
59. As an agent, I want the decision modules to be importable without booting a server, so that the credential-free suite stays reachable.
60. As a reviewer, I want the diff to contain no behaviour change, so that a structural pass can be merged on the strength of the gate alone.

## Implementation Decisions

- Four families of work, each touching one area so the branches merge without
  fighting: the app's own Session and dashboard lifecycles; the server's read
  results; the presentational panels and their memory; the installed-update
  lifecycle.
- The app family models the end of a Session as one named reason with one
  writer, replacing the empty-string sentinel and the several effect bodies
  that currently call the hand-over directly. The policy of which reasons keep
  the stored credential stays where a reader can see it.
- The app family models the one-shot load snap as an explicit armed/consumed
  decision with one owner, so a manual range edit and a load cannot race to
  disarm it.
- The app family models a cascade run as a named lifecycle, so no run, the
  current run, a superseded run and a failed run that kept partial Options are
  distinct answers rather than a ref plus three mutation values.
- The app family models the Student Search result as a named outcome, so a
  refusal, an unstated class, a class without the roll, and a class with the
  roll are distinct answers rather than combinations of nullable fields.
- The server family replaces nullable pairs, loop flags and reason strings in
  the absences walk, the section scan, the class resolver, the liveness guard
  and the backlog reader with named outcomes that the handlers narrow once.
- The presentational family gives the timetable, the postings grid and the
  installed-update flow one phase value each, so the "nothing on screen and
  nothing loading" combination cannot be rendered.
- The Student details boundary keeps its content through the slide-out. The
  extraction models that sequence explicitly at the boundary rather than
  adding another optional prop or a second boolean.
- The shown timetable keeps its read, cleared-evening and remembered-day cases
  as one named answer, without changing which value Home displays.
- No Portal call, calling convention, session marker, SWR key, cache sweep,
  band threshold, ADR or wire shape changes. No dependency is added.
- Mantine stays the only visual vocabulary and Phosphor the only icons. No
  stylesheet, CSS module or inline style is introduced.
- Pure modules stay importable without booting a server; the credential-free
  suite remains the default gate.
- The already-extracted boot decision, Session view, student panel, Load gate
  and route guard are prior art, not work items. Their shapes are copied, not
  redesigned.

## Testing Decisions

- A good test observes what a caller can see: given these inputs, the pure
  module answers this state or this action. It never asserts which internal
  branch produced the answer, how many times a helper ran, or the order of
  calls that the caller cannot observe.
- Every new pure module is tested directly at the existing decision seam, with
  examples for each named state and a property for the rule that examples
  cannot reach: a retry converges, an answered boot never retries, opening
  wins over a slide-out in flight, a superseded run asks nothing further, a
  generation dropped by Sign-out can never write again, and a missing figure
  never sorts first.
- Prior art is the explicit state machines and property state suites, which
  already hold the five extracted decisions. New cases join those files rather
  than opening a parallel suite.
- Each property is mutation-probed: break the rule it names, run only that
  test with the fast runner, confirm the named test turns red, revert. A test
  never seen red is not accepted as coverage.
- The existing browser specs and route specs are the regression gate. They are
  not rewritten for this work; if one fails, the extraction changed behaviour
  and the extraction is wrong.
- The live-portal smoke test stays out of the gate. It is the only spec that
  touches the network and needs credentials.
- The full gate runs lint, then typecheck, then build, then tests, in that
  order, from the shared setup that every invocation loads.

## Out of Scope

- Any change to what the app states: figures, bands, notes, labels, ordering,
  navigation, or which screen opens.
- Any change to the Portal seam, the Session contract, the epoch rule, the
  stored dashboard view, the SWR keys, or the wire shapes in the shared
  contract.
- Any new ADR, and any edit to an existing ADR. The decisions being modelled
  are already recorded.
- The four minor derived statuses noted in the inventory — the saved-section
  pair, the overall-mode flag, the note priority chain and the refresh flag —
  unless a family's work naturally makes one explicit.
- The live-portal smoke test and any measurement against ECAP.
- Renaming or reorganising files beyond the families named above.
- A new testing seam, a new icon library, a state-machine dependency, or a
  custom stylesheet.

## Further Notes

- The boot decision is the pattern to copy: a pure transition table with named
  actions, a dispatcher that holds no phase, and a browser spec as the gate.
- Preserve the documented reasons for the current shapes. In particular, the
  boot hand-over deliberately keeps the stored credential: a probe that never
  answered may still hold a working Session, and clearing it would re-key the
  probe on every signed-out boot.
- The two policies that travel with a Session end — which reasons show a note
  and which reasons keep the credential — belong in one readable place, not in
  the callers.
- Order the work so the four families can land independently. Each branch
  merges the integration tip before it reports done, and no branch reaches
  into another family's files.
- The gate is the acceptance criterion: all credential-free specs green, in
  the order lint, typecheck, build, test, with the mutation probes recorded.
