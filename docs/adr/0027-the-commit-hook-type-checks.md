# 0027 - The commit hook type-checks, after it lints and formats

Date: 2026-11-04
Status: Accepted
Amends the hook section of ADR 0012, which kept `tsc` out of the commit path.

## Context

`staged` ran one command, `vp check --fix`: format and lint, over the staged
files. It does not read types, and nothing else in the commit path does either —
`tsc` ran only inside Playwright's `globalSetup`. So a type error could be
committed and pushed, and was: a test file carrying a syntax error survived a
commit in this session and was caught only because a typecheck happened to run
next.

ADR 0012's reason for keeping `tsc` out was that it had just added the gate to
`globalSetup`, and a second copy looked like two gates. That reasoning holds for
the *suite*: `globalSetup` must keep type-checking, because `playwright test` is
the only command that runs everything. It does not hold for the commit: a
commit is the moment a broken contract enters history, and it is the cheapest
place to stop one.

## Decision

`staged` maps `**/*` to two commands:

1. `vp check --fix` — format and lint, staged files only (unchanged).
2. `bun scripts/typecheck-staged.ts` — the project's own `typecheck`.

The second is a wrapper because lint-staged appends the staged filenames to
every command, and `tsc` rejects them ("Option 'project' cannot be mixed"). The
wrapper ignores its arguments and checks all three projects: a type error in one
file is usually a contract change in another, so narrowing to the staged files
would miss exactly the failure worth catching.

`test/global-setup.ts` keeps its own typecheck. That is not duplication of a
*decision*, it is the suite guaranteeing itself when run directly.

## Consequences

- A type error stops the commit. Measured: a deliberate `string` assigned to a
  `number` exits the hook with `Type check failed — the commit was not made.`
- Commits take a few seconds longer; the three projects type-check in about four
  seconds warm.
- The hook is still not the whole gate: `bun run test` remains the only command
  that runs lint, typecheck, build and the suite in order.
