# 0020 - One data layer, and the keys are the contract

Date: 2026-10-16

## Status

Accepted

## Context

The app talks to six of its own endpoints — `/api/session`, `/api/options`,
`/api/register`, `/api/login`, `/api/logout`, `/api/student` — and every one of
them was a hand-rolled `fetch` inside an effect or a handler in `App.tsx`, with
its own in-flight bookkeeping beside it. That worked, and it was cheap to add one
endpoint at a time. What it accumulated was subtler than the code:

- **Four things were juggled to answer "is this answer still wanted".** A
  `refreshToken` counter for the cascade, a `detailToken` for a panel, a `busy`
  flag to keep the session probe out of the way, and `selRef` / `optsRef` so the
  cascade could read a selection that a render had not committed yet. Each was
  correct on its own; each was also a rule with nothing to enforce it, and two of
  them had already shipped wrong.
- **The same three session rules were restated at every call site.** A 401 evicts;
  a 502 does not; nothing read out of the Portal survives into the next session
  (ADR 0002, 0013). Four places had to remember all three, and the sweep on
  sign-out was one of the places that could get it half right.
- **Every failure had its own state and its own place on screen.** `overallMode`,
  `persisted` and five note strings were all "the last request said".

None of that is about *what* the app does. All of it is the bookkeeping of
reading a remote value and keeping it current, which is what a data-fetching
library is for.

## Decision

**All six endpoints move onto SWR (2.5.1), through one module, and `web/client.ts`
is the only place in `web/` that calls `fetch`.**

The invariants the app is built on are not given up; they are re-stated as rules
about **keys**, which is where they can be enforced by the cache instead of by
discipline:

- **A key is a cache entry, so anything the user must ask for again on purpose
  gets a key that changes per ask.** The register is `[REGISTER_PATH, request,
  attempt]`, where `attempt` is a counter a click increments. A key SWR has not
  seen is a load, so a repeat click is not a cache hit; and a register that lands
  after a newer one answers to a key that nothing is showing, so **the newer
  register is the one on screen** — ADR 0015's click-only rule and the
  "newer refresh always wins" rule, in one mechanism.
- **The option chain is one key, not five.** Its requests depend on each other, so
  the thing worth caching is a *run*, and a run is named by the selection it
  started from (`/api/options#chain`, a mutation). Each pass is additionally
  cached under the request it answered, so re-opening the same saved class costs
  no Portal calls. The loop itself is `runCascade(setup, fetchOptions)` in
  `cascade.ts`: pure, taking a fetcher, with the AbortSignal as its "still
  wanted" flag — never passed to `fetch`, so nothing rejects with an `AbortError`
  the caller has to tell apart from a failure.
- **A key is a promise about *whose* data it is, so nothing keyed on the server
  survives a session.** `forgetServerData()` sweeps every `/api/` key on the way
  out, and `resetCascade()` clears the mutation's own state with it, because a
  mutation's failure lives in the hook rather than the cache.
- **The session is the one thing that revalidates on its own**, and only while it
  should: a `refreshInterval` of `SESSION_PROBE_MS` when the app is idle, `0`
  while a request is in flight or the sign-in screen is up. Everything else has
  `revalidateOnFocus` and `revalidateOnReconnect` off, so a read stays something
  the user asked for.
- **`signedIn` stays state.** SWR's cache says what the last read answered, and
  signing out has to be able to say so *before* the next read answers, or the
  guard drags the user back out of the login screen. That is the bug ADR 0015
  removed the second history writer for; deriving the flag would bring it back.

Alternatives considered:

- **Hand-rolled, but extracted into a hook module.** This was the honest
  zero-dependency option, and it loses on the same ground every time: the
  `refreshToken` / `detailToken` / `busy` bookkeeping and the in-flight cache
  *are* the copy of a data layer, written here, without the tests SWR ships. The
  two bugs above both lived in that copy.
- **TanStack Query.** Bigger, and its defaults assume a screen that may revalidate
  whenever it likes. This app's whole premise is that a Portal read is asked for
  on purpose — the register especially. SWR's hook-and-key model maps onto
  "read this, on this key, and only then" with less configuration to get wrong,
  and `useSWRMutation` is exactly the shape of a click.
- **Reading the profile per row on load**, to fill columns. Rejected in ADR 0018
  on measurement (~478 ms per student, concurrency buying nothing); the panel's
  own read is unchanged here, and the cache does not change its shape.

## Consequences

- **The invariants are in one file, and the tests can see them.** The keys, the
  sweep, the probe's cadence and the wrapper that turns a non-2xx into an
  `ApiError` are all `client.ts`; `App.tsx` is screen state again.
- **The cascade can no longer read a stale render.** It receives the selection and
  the known options as arguments and returns the settled ones, so the `selRef` /
  `optsRef` class of bug — which shipped, and sent the wrong batch number — is
  gone by construction rather than by care. `cascade.spec.ts` drives the loop over
  a fake fetcher, including both abort checks.
- **There is now a cache, and it has rules.** A new key is a new cache entry; a
  read added without thinking about *whose* answers those are will outlive a
  session unless the sweep covers it. That is the price of the deletion, and it is
  the thing to check in review.
- **Reopening a student's panel shows their last answer at once** and refreshes it
  behind the panel, because the profile hook keeps SWR's own "revalidate on mount
  if stale". The read is still one call per open; ADR 0018's "no cache" is
  amended, not overturned.
- **A failed read no longer disappears when the screen changes.** The mutation
  hooks hold their own error, so signing out has to clear it explicitly. It does.
- **One dependency, and it is a data layer.** `swr@2.5.1`, about 4 kB over what
  the app already shipped to render. The toolbar for the whole front end is
  Mantine and Phosphor already; this is the same trade, made for the same reason.
