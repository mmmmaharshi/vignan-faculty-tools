# 0012 - Build after the gate, not before it

Date: 2026-09-28

## Status

Accepted

Refines ADR 0002, which moved the gates into `globalSetup` but left the build in
`package.json` ahead of them.

## Context

ADR 0002 established that a gate which only runs when a human remembers is
advice, not enforcement, and moved lint and typecheck into Playwright's
`globalSetup` so they fire for every invocation. The script became:

```json
"test": "bun run build && playwright test"
```

Which put the build **first** — ahead of both gates. That was not considered at
the time, and it is wrong in two ways.

**1. A build does not fail on a type error.** Vite uses esbuild, which strips
types without reading them. Measured, with a deliberate `const theme: number =
createTheme` in `main.tsx`:

```
build:   exit=0 in 961ms, dist/ written
tsc:     error TS2322
```

So a type error used to write `dist/` *before* the gate noticed. A failing run
left a bundle on disk built from code that does not compile, and a server already
running would serve it.

**2. `bunx playwright test` skipped the build entirely.** The gate moved to
`globalSetup` precisely so it could not be routed around — and then the build,
which `bunx playwright test` never invoked, was left outside it. So a bare
`bunx playwright test` linted, typechecked, and then tested whatever `dist/`
happened to be there. Usually stale, silently.

The same bug twice: **the tests were not necessarily running against the code
being tested.**

## Decision

Move the build into `globalSetup`, after the gates. `bun run test` is now just
`playwright test`.

Order is **lint → typecheck → build**:

- Lint first, because it is the cheapest failure at 1.4s and fails on style
  before anyone waits for three `tsc` passes.
- Build last, because it is the only step that writes anything. It should never
  run on code already known to be wrong.

Measured on this machine: lint 1444ms, typecheck 1409ms, build 865ms. A gate
failure now costs 2.9s and writes nothing, instead of 0.9s of build plus a
written `dist/`.

## Consequences

- **`bunx playwright test` can no longer test a stale bundle.** That was the
  larger risk and the less obvious one. It now builds first, every time.
- `bun run build` still exists on its own, for a developer who wants the bundle
  without running tests. `bun run dev` is unaffected — it was never gated and
  never needed to be.
- **Proven, not assumed.** With a type error present and formatting clean, lint
  passes, `tsc` fails, `bun run test` exits non-zero, and `dist/index.html` is
  verified byte-identical to a marker written beforehand. The build did not run.
- No duplication: the gates run once, not once in the script and again in
  `globalSetup`. The alternative — putting lint and typecheck in the script too —
  would have run all three twice on every `bun run test`.

## Alternatives considered

**Put the gates in `pretest` as well, leaving the build in the script.** Rejected:
that runs three checks twice on every run, to solve a problem the build moving
into `globalSetup` solves once.

**Make the build a `pretest` hook too.** Rejected for the reason ADR 0002 already
recorded: `pretest` only fires for `bun run test`, which is the bypass this whole
mechanism exists to close.

**Leave the order alone and document it.** Rejected. A gate that writes output
before it has decided is a gate that can leave the tree in a state nobody asked
for, and the cost of fixing it is one line plus one line moved.

**Have `globalSetup` run the build before the gates.** Rejected: it would rebuild
on every failing run, which is the exact waste this removes.
