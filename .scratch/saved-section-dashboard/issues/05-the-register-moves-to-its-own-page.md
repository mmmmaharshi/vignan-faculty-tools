# 05: The register moves to its own page

**What to build:** The dashboard becomes the saved Section's summary, and the
Cascade and the roster move to their own page reached by a link. The register
itself is unchanged — the same picker, the same table, the same one click to load.
What changes is that the two things stop sharing a screen.

**Blocked by:** 03 — The saved section's subjects, one row each.

**Status:** ready-for-agent

- [ ] The dashboard shows the saved Section's summary. The register page holds the
      Cascade and the roster, and is reachable from the dashboard and back.
- [ ] The Cascade, the summary cards, the range and the table are unchanged on the
      register page. Moving the page is not a redesign.
- [ ] A deep link to either page works on a cold load, before any JavaScript runs.
      Otherwise the page is a 404 and the fix reads as a broken asset.
- [ ] The sign-in guard is unchanged in both directions: a signed-in visitor sent
      to the sign-in page still goes on to the dashboard, and a signed-out visitor
      sent to the dashboard still lands on sign-in.
- [ ] The selection is still not in the URL. A refresh still starts the Cascade
      from the top, and nothing starts writing the address bar.
- [ ] The rail offers both pages and marks the current one from the path, so the
      two cannot drift apart.
- [ ] `Load register` is still an explicit decision on the register page, and
      visiting the dashboard is not one.
- [ ] The test pinning "a click is the only way a register is ever fetched" is
      rewritten, not deleted. It guarded a rule that is now the opposite of the
      rule, and the new one asserts a fetch per Subject on a dashboard visit.
- [ ] The manual and the decision record are corrected in the same change, so no
      document describes behaviour the code does not have.
