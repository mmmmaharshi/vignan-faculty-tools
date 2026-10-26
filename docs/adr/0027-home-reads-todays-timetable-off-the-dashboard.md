# ADR 0027: Home reads today's timetable off the faculty dashboard

## Status

Accepted.

## Context

Faculty asked for a Home tab showing their own timetable for today. Two ways
to feed it: find ECAP's own surface, or have each faculty member type their
weekly timetable once and keep it in the browser. The second is days faster
to build but re-typed every semester and wrong the moment a substitution
happens; the first was unknown — no timetable endpoint existed anywhere in
`server/` — until a live probing session (2026-10-23) walked the portal with
a real sign-in.

## Decision

Home reads ECAP's own `GetToDayClasses` on the faculty dashboard's proxy
(`Academics_facultydashboard`), through `POST /api/today`:

- The proxy definition is the contract: `_session=r`, no parameters, and the
  page calls it with none — so neither does the server. Asking with `no`
  answers a session-state `HttpException` instead of a timetable.
- The answer is an HTML fragment for the `tblschedule` grid, parsed by
  `parseTodayClasses` in `portal-replies.ts`. The grid has no header row —
  each row is the period and time in the first cell, subject over section in
  the second — so positions are fixed by the shape ECAP itself pinned live
  (2026-10-24), not guessed. An `<hr/>` stacks a second subject under the
  first and reads as two periods at the same time; an empty second cell is a
  free period, and it keeps the hours the grid stated for it — only the class
  is blank, so no slot is left for the front end to time by guesswork. The
  grid states no room, so room always reads empty.
- A fragment with no schedule grid — the bare `</table>` ECAP answers after
  ~4pm, when it clears the day — is an empty day, never a failure. The panel
  still names every slot: stated periods as ECAP gave them, the rest reading
  No Classes Today. A refused call throws before the parser is reached, so a
  502 still says the read failed and a 401 still ends the session.
- Home is the landing screen (`/home`, first tab, House icon). The read
  happens when Home opens and refreshes behind the cached answer on return;
  the key is an `/api/` key, so sign-out sweeps it. Sundays, holidays, and
  cleared evenings share the one row — ECAP gives no holiday
  list and none is hardcoded.

## Consequences

- No manual timetable entry: one more portal read through the same handler
  shape as every other.
- The hours are remembered, in `web/period-times.ts`, keyed by period name:
  every read folds its stated hours in, so a period that moved corrects
  itself and a read that states nothing never erases what was learnt. It is
  what lets a cleared evening — when ECAP states no hours at all — still show
  when each period it has once seen meets. Portal data, not personal data, so
  it survives sign-out with the next user; a slot never once timed shows no
  hours rather than invented ones.
- The row parser's shape is pinned by the live teaching-day reply
  (2026-10-24), not by a guess: the header patterns are gone with the header
  they assumed, the free-period row keeps the hours the grid stated for it,
  and the `<hr/>` stacking is the grid's own semantics, covered by the same
  live fixture.
