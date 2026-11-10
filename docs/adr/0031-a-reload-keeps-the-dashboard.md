# 0031 - A reload keeps the dashboard the page last showed

Date: 2026-11-10
Status: Accepted

## Context

ADR 0015 put the selection outside the URL and accepted the cost in one
sentence: "a refresh starts over". Reloading `/dashboard` therefore showed the
class form refilled from the top and no table at all.

That reads as a fault rather than as a rule. Measured in a browser: load a
register, reload, and the screen is still `/dashboard`, still signed in, with the
roster gone and nothing on screen saying why. On a phone or an installed app the
platform discards and reloads a backgrounded tab routinely, so this is not a
button the user pressed — it is something that happens "some time after visiting".

## Decision

Keep the dashboard view in the browser and put it back on load:

- What is kept is the reply the table was showing, the click that asked for it,
  the class the form named, the date window, and the ticked bars and search.
- **No Portal call restores it.** The reply is handed to the cache under the key
  its click answers to, before the register hook asks for it, so the rows appear
  from what the browser holds. A reload stays the only path that shows a register
  without asking for one, and it still is not a *read*: nothing new arrives.
- The **options** are re-read, because they are what the picker displays and a
  renamed subject or a new section should correct itself. That read is allowed on
  every boot already.
- One storage key, not one per user: this is a live view, not a personal
  collection. It is cleared by `signedOut` with everything else that came from the
  Portal, and the new session starts blank.

## Consequences

- A reload is no longer a way to see a stale number as a fresh one without
  noticing — but a restored table can be as old as the last load in that tab. It
  is a reload of the same page seconds earlier in every case this fixes; a page
  left open for hours and then reloaded shows what it showed, and the Date Range
  facts above the table still name the window the figures cover.
- **The rows are student data and now live in `localStorage`**, scoped to nothing
  but the browser. They are cleared on sign-out, and they never travel to the
  server. Anyone holding this browser's storage already holds the ECAP credential
  by ADR 0024, so this widens what is exposed by the roster of one section, not by
  a class of secret. That is the trade, stated.
- `Load register` stays the only way a register is *fetched*: the smoke test still
  counts one `/api/register` POST per click, and a reload adds none.
- A stored view that fails to read back — an older shape, a refused write — is
  dropped and the dashboard starts as it did before, which is the old behaviour
  rather than an error.
