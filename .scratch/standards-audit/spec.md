# Standards audit: does CODING_STANDARDS.md change behaviour?

**Status:** open
**Question:** which rules in `CODING_STANDARDS.md` change what an agent writes, and did the v2 wording improve on HEAD?

## Why a run and not a read

A rule either changes the diff or it does not. Read off priors, ~18 of 30 rules look
like no-ops (the model already does them unprompted), but that is a debate, not a
measurement. This spec settles it with 12 runs.

## The confound, and why there are two experiments

`AGENTS.md` says *"Always follow CODING_STANDARDS.md. Read it before writing code
here."* — so an agent run in this repo reads the file whether or not the test asks
it to. A plain "with file / without file" A/B cannot be run here without also
stripping that pointer.

Two experiments, in priority order:

- **E1 — wording.** HEAD version vs v2, same pointer, same task. Answers *"is v2
  better?"* This spec's first job.
- **E2 — presence.** v2 vs no file at all (pointer line removed from `AGENTS.md` in
  a scratch copy). Answers *"is this rule load-bearing at all?"* Produces the cut
  list. Only run after E1.

## Probes

Each probe is a small task with **one known default failure** — something a model
does unprompted unless a rule stops it. Score the failure, nothing else.

### P1 — the flag

Targets: *Stable Function Signatures*, *Command-Query Separation*.

```
Extend the register load so a caller can ask for a read that bypasses the SWR
cache once. Keep the change small.
```

**Tell:** the model adds a boolean parameter (`skipCache: boolean`, `fresh: true`)
or an options bag threaded through an existing signature, instead of a separate
function or a key that already varies.

**Not a tell:** a new function with a new name. That is the rule working.

### P2 — the fallback

Targets: *No Backward Compatibility*, *Error Handling*.

```
ECAP's student profile page can come back in a shape the parser does not expect.
Make the panel show what it can instead of failing outright.
```

**Tell:** the model returns partial or default data on a parse failure, or keeps
both the old and new parse paths alive.

**Not a tell:** a named error the panel states in words, with the failed read
surfacing as a failure. That is the rule working.

## Method

1. One fresh agent session per run, same checkout, same probe text.
2. Three runs per probe per arm. Record only the tell: `yes` / `no`.
3. A rule **bites** when the tell flips in at least 2 of 3 runs.
4. Never score a run by its reasoning text — the diff decides.

## Results

Fill one row per run. `arm` is `E1-head`, `E1-v2`, or `E2-none`.

| probe | arm | run | tell | notes |
| ----- | --- | --- | ---- | ----- |
| P1    |     | 1   |      |       |
| P1    |     | 2   |      |       |
| P1    |     | 3   |      |       |
| P2    |     | 1   |      |       |
| P2    |     | 2   |      |       |
| P2    |     | 3   |      |       |

## Decision rules

- **E1, v2 flips more tells than HEAD** → keep v2, commit it with these results in
  the commit body.
- **E1, no difference** → the rewording bought nothing; revert to HEAD wording and
  keep only the demand line at the top.
- **E2, a rule's tell never appears with it or without it** → that rule is a cut
  candidate. Collect them and cut in one change, keeping the leading word in the
  anti-patterns section where it still greps.
