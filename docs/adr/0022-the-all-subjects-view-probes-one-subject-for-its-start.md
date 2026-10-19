# 0022 - The All subjects view probes one subject for its earliest held day

Date: 2026-10-18

## Status

Accepted

## Context

On a subject register the From input snaps to the register grid's own first
date column (`statedFrom`), and the facts card names it twice: as the Date
Range start and as its own Sem Start Date row. That first column is the
earliest day the Portal holds for that subject inside the asked window — the
closest thing ECAP gives to a semester start date, which it otherwise never
states (the Portal has no semester start date to give, and `GetDates` is only
month-to-date).

The **All subjects** path has no such column. It reads the Class attendance
report (`ShowAllAttendance`), which aggregates by subject — `Sl.No | Roll.No |
Student Name | <subjects> | Total | Percent` — with zero date columns. So on
this path the facts card showed the typed From (e.g. a deliberately far-back
`06/05/2026`) with nothing to cap it to, and no Sem Start Date row at all. A
faculty member testing the snap by typing an old date saw the date stay put
and read it as a broken snap; it was the report that had no answer, not the
snap that had failed.

## Decision

On the All subjects path only, after the register loads, the client asks a
new `/api/sem-start` endpoint for the **first offered subject's** own register
over the **same range**, and the server answers with only that grid's first
date (`{ statedFrom }`). The facts card prints it as `Sem Start Date`, the
From input snaps to it, and the Date Range fact starts from it — everywhere
the subject path's own `statedFrom` already does all three. The row carries no
subject name; the probe subject is an implementation detail, not a claim about
the section.

Three deliberate limits:

- **One subject, not all.** The section's true earliest day is the min across
  subjects, but that is a fan-out of N register reads per load — the shape ADR
  0016 built and removed. One probe is the affordable answer.
- **The user's own range, not a wider one.** A fixed "five months back" window
  is a magic number that misses older semesters and assumes the Portal answers
  wide ranges the same way. The probe reuses the asked window: when the user
  widens to find the start, the probe finds it too.
- **Never on the subject path.** A subject register's own grid already states
  its days, so the probe is not sent there (`useSemStart` is keyed null).

## The earliest day ever seen wins

A probe — and a register grid — only ever sees the asked window. Ask from
October and the first day on screen is October's, even when the semester began
in August. So the client remembers, per class in `localStorage`
(`web/sem-starts.ts`), the earliest start day any load has stated, and the Sem
Start Date row names the memory, not the window. A later From still moves the
figures, the From input and the Date Range — those describe the window on
screen — but the row keeps the original start. The key is the five levels plus
the Portal's batch title (`2025`), so a new academic year starts a new memory
rather than inheriting last year's; it is Portal data, not personal data, so it
is not scoped by user id and survives sign-out.

Failure rules: a probe that fails changes nothing — the register on screen is
complete without it — except a 401, which still ends the session through the
shared sweep, because a dead session is a dead session however it was found.
`test/smoke.spec.ts` still counts `/api/register` POSTs on the wire unchanged:
the probe travels on its own path, so "Load register is the only way a register
is ever fetched" survives the rewrite.

## Consequences

- An All subjects load costs one extra Portal call (a grid read, no roster
  parsing beyond its header). Verified live: same-window probe for MFCS
  returned `05/08/2026` while the typed From was months earlier.
- Where the probed subject's grid states no dates, no Sem Start Date row is
  shown — stated as nothing, never as a clean sheet, same as the snap.
- `chosenFacts` still owns the subject path's Sem Start Date row from
  `statedFrom`; the probe only feeds the All subjects path, which has no
  `statedFrom` of its own.

## The panel's full-semester absent list

The dates on a panel are the register's own columns, and the Portal states only
the days inside the asked window — so a window narrowed to October shows October
absences, not the semester's. The panel therefore reads the **same** read again
over the remembered start and shows it as a second list, `Absent — full
semester`, beside the window's own. No new kind of Portal call: the subject path
reads the same register grid, the All subjects path the same Student Wise grid.

It is asked only when the window starts after the remembered start. When they
coincide, the list on screen already is the full semester and there is no second
list to show. The read is gated on the drawer being open, not merely on a
student being set: `detail` survives the ~200ms slide-out by design, and a
register loaded in that window must not read for a panel that is already
leaving.

Two windows on one panel is the risk here, so each list names its own period:
the window's list keeps its range line, and the semester's names the remembered
start to the same end. A grid that states no dates is stated as nothing, never
as a clean sheet.
