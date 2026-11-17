# 05 — Audit and retrospective follow-ups

Status: resolved
Spec: `.scratch/explicit-state-machines/spec.md`

## Origin

Two later user requests, each recorded here because no issue tracker issue was
opened for them.

1. "fix all" on the repository audit: a 60s Portal call against a 60s function
   budget, an absences walk with no shared deadline, an options mutation key
   without the session generation, and a `within()` timer left uncleared.
   Fixed in `8eb8f8d`.
2. "fix all" on the retrospective: a build-then-probe script, issue tickets
   visible to worktree agents, a pointer to prior structural analysis, a
   review rule against comments that narrate removed code, and the maintenance
   prose moved behind a pointer. Fixed in `9f3ebda`.
3. "fix all" on the merge-risk gaps: a slow-call signal in the Portal transport
   and this record of origins and rollback.

## What changed

- `HTTP_TIMEOUT_MS` is 12s so four revival calls fit inside 60s.
- `readFullSemesterAbsences` has one 20s deadline and keeps the months it read.
- The options mutation key and per-request cache key carry the epoch.
- `within()` clears its timer on settlement.
- `bun run test:probe` builds before the fast config.
- The issue tickets are tracked; `.scratch/untangle-codebase/` has a pointer.
- `docs/maintenance.md` holds the measured traps; AGENTS.md keeps the index.
- A Portal call over 8s writes one line to the function log.

## Rollback

All of it sits on `master` in merge commit `86bb749`. Two-way door: a revert of
that merge restores the prior tree, with no data migration or stored-format
change. Signing out already clears the only session-scoped browser state, and
no register rows are stored at all.
