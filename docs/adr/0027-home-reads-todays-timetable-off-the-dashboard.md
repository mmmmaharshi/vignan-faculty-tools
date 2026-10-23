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
  `parseTodayClasses` in `portal-replies.ts`. Columns are read by what the
  grid's own header names, never by position: only the cleared evening has
  been seen live, so the teaching-day shape is still unpinned and positions
  cannot be trusted.
- A fragment with no schedule grid — the bare `</table>` ECAP answers after
  ~4pm, when it clears the day — is an empty day ("No periods today"), never
  a failure. A refused call throws before the parser is reached, so a 502
  still says the read failed and a 401 still ends the session.
- Home is the landing screen (`/home`, first tab, House icon). The read
  happens when Home opens and refreshes behind the cached answer on return;
  the key is an `/api/` key, so sign-out sweeps it. Sundays, holidays, and
  cleared evenings share the one honest empty state — ECAP gives no holiday
  list and none is hardcoded.

## Consequences

- No manual timetable entry and no new storage: one more portal read through
  the same handler shape as every other.
- The row parser's non-empty path is pinned by property (column order does
  not matter), not by a live teaching-day reply. The header patterns are
  deliberately unanchored until that shape is pinned — a column ECAP names
  with none of these words reads empty rather than misreading its neighbour.
  The first live reply on a teaching day should confirm the header words.
