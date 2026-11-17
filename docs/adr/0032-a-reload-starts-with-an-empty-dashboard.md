# 0032 - A reload starts with an empty dashboard

Date: 2026-11-17
Status: Accepted
Supersedes: 0031

## Context

ADR 0031 kept the dashboard view in localStorage so a reload showed the roster
the page last had. That made the tab feel continuous, but it also meant a
section's student rows, the date window and the ticked bars were still in the
browser after the app was closed and reopened. A user who expects a fresh start
on reopening sees a table from a previous sitting with no marker saying when it
was read.

The other half of the original decision still stands: the selection is not in
the URL (ADR 0015), so a link to `/dashboard` cannot carry a register to another
person. Keeping a view in storage was the part that made a register outlive the
visit that asked for it.

## Decision

The dashboard view is memory only. Every load starts with an empty selection,
the default date window, no ticked bars and no click, so `/dashboard` always
shows the form and no table. The cascade still settles on boot and re-reads the
options, so a renamed subject or a new section corrects itself; nothing in that
path fetches a register. `Load register` remains the only way `/api/register` is
ever fetched.

No student rows are written to localStorage. The server keeps no session, so
the credential and the ECAP password still live there by ADR 0024, and the
timetable's own periods and the remembered semester starts remain as Portal
facts. Those are not student data.

## Consequences

- Closing and reopening the app, or reloading a backgrounded tab, loses the
  table. This is deliberate and visible: the form is empty, so the reader knows
  a new `Load register` is needed.
- No roster can be opened by the next person on the browser. The previous view
  is gone before they sign in, so the hand-over no longer depends on every
  session-ending path clearing a storage key.
- A stale figure cannot be mistaken for a fresh one. Every figure on screen came
  from the load that put the table there.
- The reload browser specs now pin an empty dashboard and no second register
  call; the smoke test no longer expects the previous register after a reload.
- ADR 0031 is superseded rather than amended: it records the decision that was
  true from 2026-11-10 to 2026-11-17.
