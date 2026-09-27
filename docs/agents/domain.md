# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

**Layout: single-context.** This repo has one deployable unit and no
monorepo signals — no `pnpm-workspace.yaml`, no `workspaces` field, no populated
`packages/*`. If that ever changes, replace this file with a `CONTEXT-MAP.md` at
the root pointing at one `CONTEXT.md` per context, and note the switch in an ADR.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`docs/adr/`**: read ADRs that touch the area you're about to work in

If either of these does not exist, **proceed silently**. Do not flag their
absence, and do not suggest creating them upfront. The `/domain-modeling` skill
(reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them
lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
└── docs/
    ├── agents/            ← this file and its siblings
    │   ├── domain.md
    │   ├── issue-tracker.md
    │   └── triage-labels.md
    └── adr/
        ├── 0001-....md
        └── 0002-....md
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal,
a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Do not drift
to synonyms the glossary explicitly avoids.

If the concept you need is not in the glossary yet, that is a signal: either you
are inventing language the project does not use (reconsider) or there is a real
gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_

## Vocabulary already established

The domain has no `CONTEXT.md` yet, but these terms are load-bearing and are used
consistently in `server.js` and `AGENTS.md`. Treat them as the seed glossary:

- **portal** — the ECAP web application. Not to be confused with the local app.
- **cascade** — the dependent chain course → semester → branch → section →
  subject, where each level's options are produced by the level above it.
- **register** — the roster of students with per-student attendance for one
  subject over a date range. Also the name of the portal page that produces it.
- **label cache** — the per-session map from a dropdown option's value to its
  visible text, needed because `ShowAcademicCalendar` requires both.
- **regular / irregular / critical** — attendance bands at 75% and 60%.
