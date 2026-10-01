# 01: The signed-in name survives a restart

**What to build:** The app knows who is signed in even when the session came back
from the credential vault instead of being typed. Today a restored session shows a
dash for the user name, because the name is set in exactly two places and neither
is a restore. The session check reports the name, and the profile panel and the
rail show it after a restart with no password typed.

This lands first because the saved section is keyed by user name, and nothing can
be keyed without it.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The session check reports the signed-in user's name alongside the
      signed-in flag, and reports it whether the session was typed or restored.
- [ ] A session restored from the credential vault shows the user's name in the
      profile panel and the rail, with no password typed.
- [ ] The stored session carries the name, and it survives a write and read round
      trip unchanged. A reader that rebuilt only the three fields it already
      knew would drop it silently, which is the failure this guards.
- [ ] A session stored before this change still loads. Its name is simply empty,
      and the session is not discarded.
- [ ] The stored entry stays within the per-entry credential size cap the suite
      already pins, and the session index stays within its own budget. The
      credential is a fixed-size blob and a fifth entry would be rejected.
- [ ] The name is the user's own, taken from sign-in, and is never derived from
      anything the Portal displays about them.
