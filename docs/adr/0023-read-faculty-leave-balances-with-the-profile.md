# 0023 - Read the faculty's leave counts with the profile

Date: 2026-10-20

## Status

Amended — the per-stage grid replaced the balances (see Amendment below).

## Amendment (2026-10-21)

The balances answered the wrong question: the faculty member wanted the
application breakdown, which lives one screen further in, on the ACADEMICS
menu's **LEAVES → APPLY-SELF** page (`ACADEMICS/LeaveRequest.aspx?scrid=4039&
type=s`). Its `showLeaves` proxy method (on the `Academics_LeaveRequest`
generated proxy, `_session=r` as the proxy declares) states one row per leave
type with `Leave Type | Eligible | Applied | Approved | Pending | Declined |
Available` — measured live as Eligible Casual Leave `10/6/5/1/0/4`. The
balance reader, its page URL and its seam tests were removed; nothing reads
`rptstaffleaves.aspx` any more.

Finding that page cost real work, recorded here so nobody repeats it: the main
page is a shell whose menu arrives through `FillLinks` (`ModuleId=4` is
ACADEMICS), whose headings open hover submenus (`LEAVES` is screen 4012), and
whose `ShowPage('', token)` entries resolve through `CheckAuthentication`
with an **empty** parent folder to a root-relative path (`/LeaveRequest.aspx`)
that only loads under `/vignanit/ACADEMICS/`. And the grid's Approved cell is
never closed (`5</div</td>`), so the parser takes the number at the front of
each count cell rather than the cell as it stands.

## Context

The Profile screen reads three facts from ECAP's `main.aspx`: the faculty
member's name, photo and designation code. A faculty member's leave balances are
on a fourth screen, **Employee → Leaves History**
(`Employee/rptstaffleaves.aspx`), which states one row per leave type with
`Opening`, `Used` and `Available` figures. The same page also carries a
**Used Leaves History** table of dates, which is not a balance.

The profile is opened deliberately and occasionally, and the leave page answers
only for the signed-in user — there is no roll number or class to pass. So the
question is only whether the page is read with the profile or behind a second
action on the screen.

## Decision

The leave balances are read **with the profile**, in the same
`Portal.facultyProfile` call that reads the name, photo and designation.
`parseFacultyLeaves` finds the grid whose own header names `Opening`, `Used` and
`Available`; that header is what separates the balances from the used-leaves
table below it. The three figures are stored as the page writes them and shown
under a **Leaves** table on the profile panel.

- **A leave page that cannot be read is no leaves, not a failed profile.** The
  name and photo still answer the question the screen was opened for, so the
  page's failure is swallowed there and the panel says `—`.
- **The page URL needs no query string.** The menu reaches it through
  `CheckAuthentication`, but the page itself reads the balances from the signed-in
  session, and a live read confirmed the URL works directly.
- **Nothing is computed.** `Available` is the page's own column, not
  `Opening - Used`.

## Consequences

- **Opening the profile costs one more Portal GET.** It is the only caller and it
  runs when the panel opens, not on a register load.
- **A layout change shows no leaves rather than wrong leaves.** The header check
  is the seam, and `test/seam.spec.ts` pins it against the used-leaves table.
- **The used-leaves history is not read.** It is a list of dates, not a count,
  and the profile asks for counts.
