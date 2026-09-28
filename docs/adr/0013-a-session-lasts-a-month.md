# 0013 - A session lasts a month, so the probe has to ask the portal

Date: 2026-09-28

## Status

Accepted

## Context

`SESSION_TTL_MS` was twelve hours, with the cookie's `Max-Age` derived from it.
The request was for at least a month, so the number becomes thirty days.

That is a one-line change with a problem attached, and the problem is the reason
this ADR exists.

`/api/session` reported `s.portal.signedIn`, and `Portal.signedIn` is
`cookies.has("frmAuth")` — it means *an `frmAuth` cookie is in the jar*. It never
asked the portal anything. So the probe would report "signed in" for a session
whose ECAP counterpart had been dead for a week, and the user would get a
dashboard that failed every call.

At twelve hours that was mostly theoretical. At thirty days it is the **common
case**: our session is a `Map` entry with a timestamp, theirs is whatever ECAP
decides, and it will not last a month.

## Decision

**1. Thirty days**, sliding — `getSession` stamps `at` on every request, so it is
a month of *not using it*, not a month from signing in. The cookie's `Max-Age` is
derived, so the browser and the server cannot disagree.

**2. `/api/session` asks the portal.** `await s.portal.courses()` is the cheapest
call that genuinely goes over the wire, and a 401 evicts the session.

**3. The probe interval is five minutes, not thirty seconds.** The probe now costs
a real round trip to someone else's server. Thirty seconds would be two requests
a minute for as long as a tab is open, and with a thirty-day session there is
nothing it would catch sooner.

### What the portal check does *not* catch

Only a 401 evicts. A dead session is detected on **convention B**, which inspects
its reply for HTML and answers 401 (`#webMethod`). **Convention A has no such
check**, so a dead session there arrives as a 502 — an unreadable or errored
reply — and a 502 is ambiguous. It could equally be a portal that is down, or
markup that has moved.

Signing the user out on that would turn a transient outage into a lost session,
which is the trade ADR 0002 already refused when it chose `emptyLevels` over a
502. So a 502 reports signed-in and the real request surfaces it.

The guaranteed path is therefore unchanged: a dead session is caught by the 401
on the next convention-B call, which `/api/register` and the subject step of
`/api/options` both do. This probe turns "the first thing the user does fails"
into "the dashboard notices first". That limit is stated in the handler, because a
check that is quietly partial is worse than one that is honestly partial.

## Two bugs this work uncovered, both pre-existing

Neither was caused by the TTL change — both were found by probing the flow and
then reproduced on the previous commit to prove it.

**Signing out bounced straight back to the dashboard.** `signedOut` navigates to
`/login`, and the URL-write effect was landing *after* that navigation and
dragging the path back to `/`. The trace shows it plainly:

```
> POST /api/logout   < 200
NAV -> /login
NAV -> /?from=2026-09-01&to=2026-09-28     <- this one should not have happened
```

Two competing history writers in the same tick. The fix is the condition the
effect already wanted: **skip while the selection is empty.** There is no register
to name, and a session that has just ended must not have one written back. It also
keeps the "a fresh app has no query string" behaviour, which is the same case.

**Signing out showed a blank alert instead of the reassurance.** `signedOut("")`
passed an empty reason, and `setLoginNote({ kind: "warning", text: "" })` is a
*truthy* object with empty text, so it took the `note` branch and replaced the
sign-in reassurance with an empty box. Now the note is only set when there is a
reason: an expiry explains itself, a deliberate sign-out needs no excuse.

Both have a mutation check.

## Consequences

- **The session test got 8× faster** — 33s to 3.4s — because signing out no longer
  takes a route that ends up loading a register.
- Three assertions added, each proven to fail by breaking the thing it describes:
  the cookie lasts about thirty days, the sign-in form says thirty days, and both
  bugs above stay fixed.
- **Sessions are still in memory.** A server restart signs everyone out, which at
  thirty days is more surprising than it was at twelve hours. Persisting them would
  mean writing session material to disk, and this app is bound to 127.0.0.1 and
  serves one user. Not built; the honest answer is that "a month" is a month of not
  restarting the server.

## Alternatives considered

**Re-use of the `Map` without asking the portal.** Rejected: that is the bug this
change exists to prevent.

**Evict on any portal error, including 502.** Rejected for the reason above — it
would sign the user out whenever ECAP had a bad minute, and a lost month-long
session is a much worse outcome than an error message.

**Keep the probe at thirty seconds.** Rejected on cost to a third party. Two
requests a minute to someone's server, forever, is not a thing an app should do
for a check that cannot report anything new in that time.

**Persist sessions to disk so a restart does not sign you out.** Not built. It is
real work — session material at rest, a file to secure and expire — for a local
single-user app whose server is started by hand. Say the word and it is a
separate ADR.
