# ECAP Attendance Dashboard

A local, read-only web app that reads class attendance from the ECAP portal so a
faculty member can see who is drifting in a class early enough to act on it.

## Standards

**Always follow [CODING_STANDARDS.md](./CODING_STANDARDS.md).** Read it before
writing code here. It is binding, and it wins over anything else in this file.

## Communication

**Always respond in `/i-have-adhd` style.** Load the skill and follow it: lead
with the concrete next action, number multi-step work, keep state visible across
turns, and cut tangents. It lives in `~/.agents/skills/i-have-adhd`.

## Commands

```sh
bun install                # once
bun run build              # front end -> dist/
bun server.ts              # http://127.0.0.1:8787
bun run dev                # Vite on :5173, proxies /api to :8787 (run both)
bun run typecheck          # tsc over all three projects - see the trap below
bun run lint               # oxlint + oxfmt check, no writes
bun run lint:fix           # oxlint --fix + oxfmt, writes
```

### Background servers

Before starting a dev server, check whether one is already running and reuse it
if so. A second start fights the first for the port: the older process keeps
serving stale code while the new one dies on a bind error, and the leftover is
easy to forget about. Never leave two bound to the same port.

```sh
Get-Process node,bun,deno,python,go,java -ErrorAction SilentlyContinue
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
```

## Layout

```
server.ts            Bun HTTP server: routing, sessions, static files, the Portal transport
server-routes.ts     the two route handlers, over a PortalReader; no HTTP in it
portal-conventions.ts the portal's wire conventions: bodies, cipher, cookie jar; no I/O
portal-replies.ts    pure string -> data functions, and the seam guards
attendance-bands.ts  the Regular / Irregular / Critical rule, and the summary
web/index.html       Vite entry point
web/main.tsx         React root + MantineProvider; the only createTheme call
web/App.tsx          state, the three modes, and the refresh loop
web/cascade.ts       the cascade's rules: what auto-fills, when to keep looping
web/components/      four presentational modules; none of them holds state
web/types.ts         Note, the one shape three modules share
shared/api.ts        the server/client contract; both sides import it
vite.config.ts       build config
playwright.config.ts test runner config
oxlint.config.ts     linter rules, from the Ultracite preset; 92 rules off with reasons
oxfmt.config.ts      formatter, from the Ultracite preset; markdown excluded
test/seam.spec.ts    portal-replies over fixture markup
test/conventions.spec.ts  the wire conventions, the cipher, the cookie jar
test/bands.spec.ts   where the attendance lines sit
test/routes.spec.ts  the options ladder and the register handler, over a fake portal
test/cascade.spec.ts the cascade's rules
test/smoke.spec.ts   one end-to-end pass against the live portal
tsconfig*.json       three projects, split so web/ has DOM and server.ts does not
dist/                build output, served by server.ts (not source)
```

**One rule explains this layout: importing `server.ts` boots a server.** Anything
with a decision in it therefore lives in a file importable without one, and
`server.ts` is HTTP plumbing only. A network call in any of those files makes the
credential-free suite unreachable.

## Routing

Two routes: `/` is the dashboard, `/login` is the sign-in form. Anything else
redirects to `/`. **`App` owns both** — the router is not asked to split it,
because that would duplicate the cascade's state or move it into a context, and
ADR 0005 rejected a context for that reason.

- **The server serves `index.html` for extensionless paths**, or a deep link to
  `/login` 404s before any JavaScript runs. A path *with* a dot is a real file
  request and still 404s, so a broken asset reference is not answered with HTML.
- **The guard has two halves.** The boot check handles deep links. A second effect
  sends a *signed-in* user from `/login` to `/`, because the first only runs on
  mount and Back from a signed-in dashboard lands on `/login` — verified in a
  browser, and it showed the login form to someone who already had a session.
- `booted` and `signedIn` are not screens. They are the two facts the URL cannot
  carry: whether `/api/session` has been asked, and what it said.

The **selection and the date range live in the query string** too, so a register
can be bookmarked, shared, and survives a refresh:

```
/?course=1&semester=3&branch=6&section=1&subject=2946&from=2026-09-01&to=2026-09-28
```

- **Only identifiers travel, never labels.** `/api/options` returns every level
  with its label, so a label in the URL is a second copy free to disagree.
- **Written with `replace`, always.** The URL is a snapshot, not a history: the
  auto-fill commits `sel` several times, and Back through five dropdowns is not
  something anyone wants.
- **The subject is replayed after the passes settle**, because the cascade clears
  it on every pass and it is never auto-filled. Restoring a subject someone chose
  is not the same as picking one.
- **A link opens the register; a click is not doubled.** When the cascade settles
  with a subject chosen, the register is fetched. There is deliberately no flag for
  this — `draft.subject` *is* the condition, because `applyOptions` clears the
  subject on every pass and only the URL seed ever sets it. Picking a subject from
  a dropdown never reaches that point, so `Load register` stays the user's click.
  ADR 0011.
- `fetchRegister(levels, dates)` takes the selection as **arguments**, not from
  state. The cascade calls it before React commits a render, so a version closing
  over `sel` sends the previous selection — which is how the auto-load first
  arrived saying "Choose a course first" on a link whose course was plainly set.
  Same class of bug as the `optsRef` one below, from a new direction.
- `selectionToQuery` / `queryToSelection` are in `web/cascade.ts` and tested
  there, not in `App`.

## The front end is Mantine-only

There is no custom CSS in this project: no stylesheet, no CSS module, no inline
`style` prop. Visual decisions are Mantine components, or Mantine colour tokens
read through Mantine's own `bg` and `c` props. If you find yourself wanting a
custom rule, the answer is usually a component prop that already exists — check
`Table.Tr bg`, `Table striped`, `Badge color` before reaching for CSS.

The Mantine theme is stock, with **one** exception: `fontFamily`, set in
`web/main.tsx` to Scoutie Sans. `main.tsx` holds the only `createTheme` call in the
project, and it is the single place a theme decision may go. Wanting a second
theme key means you want a component prop instead.

## React

**While writing front-end code, consult `vercel-react-best-practices` and
`vercel-composition-patterns`.**

## Things that will bite you

- **The portal is a client-side shell.** Its Academic Register page renders no
  dropdowns at all; the page's own JavaScript builds them by calling remote
  methods. There are two different calling conventions and using the wrong one
  returns an empty result with no error. `server.ts` documents both.
- **The password is AES-encrypted client-side before it is posted**, as bare
  ciphertext — not the OpenSSL `Salted__` form stock CryptoJS produces. This
  portal's `JSFiles/jsaes.js` is a custom build, and a wrong ciphertext never
  raises the Click event, so a good password looks like a bad one.
- **`ShowAcademicCalendar` needs every level twice**, value *and* visible label.
  Passing only values returns nothing rather than failing, with no error to
  explain it. The front end therefore sends each chosen level **whole** — the
  `Option` it already holds — rather than a bare value, and the server checks
  both halves are present. There used to be a per-session label cache for this;
  it was removed once the smoke test could prove the portal accepts labels from
  the client. Do not reintroduce it.
- **`Bun.fetch` does not store `Set-Cookie`.** Redirects have to be followed by
  hand or the auth cookie is dropped mid-flow and a successful sign-in looks
  like a failure.
- **End a session through `signedOut`, never a bare `setPhase("login")`.** A 401
  only fires when something asks the server for something, so a user who leaves a
  register open comes back to numbers from a session that no longer exists. The
  probe on `SESSION_PROBE_MS` covers that; `signedOut` covers the rest, because a
  bare phase change changes the screen while the old session's filter, options
  and register stay in state — signing back in then produced a table already
  narrowed by a choice made against a session that no longer existed.
- **`/api/session` answers 200 with `{signedIn: false}`** when signed out, not
  401. Checking the status code alone silently runs the signed-in path.
- **Do not read `event.currentTarget` inside a `setState` updater.** React clears
  it when the handler returns and the updater runs later, so
  `onChange={(e) => setX((x) => ({ v: e.currentTarget.value }))}` throws
  "Cannot read properties of null" the first time anyone types. Read the value
  into a local first. This shipped once and blanked the whole page.
- **`toISOString()` is a UTC conversion, and a date a human means is local.**
  `defaultRange` used it on a local-midnight date and opened the range one day
  early for every reader east of Greenwich.
- **Vite hashes asset filenames.** `server.ts` caches `/assets/*` immutably and
  `index.html` not at all; changing that pair reintroduces "my fix did nothing".
- **Every Playwright run lints, typechecks, then builds — in that order.** Vite and
  Playwright both use esbuild, which strips types without reading them, so a
  passing build says nothing about types, and nothing else in the toolchain
  lints. All three live in `test/global-setup.ts`, which Playwright loads for
  every invocation — deliberately not a `pretest` script, which only fires for
  `bun run test` and left `bunx playwright test` able to skip them. Build **last**:
  it is the only step that writes anything, and it does not fail on a type error,
  so building first meant `dist/` was written from code already known to be
  wrong — and `bunx playwright test` skipped the build entirely and tested
  whatever was on disk. See ADR 0002 and 0012.
- **`runRefresh` is memoised with `[]`, so it closes over render 1.** Anything
  inside it that reads `sel` or `opts` must go through `selRef` / `optsRef`
  instead. Reading `opts` directly compiles, runs, and silently yields
  `EMPTY_OPTS` forever. This shipped: the semester's batch number stopped being
  sent and the section list came back from the wrong batch, with nothing on
  screen to show it. `test/smoke.spec.ts` now watches the wire for it.
- **The three tsconfigs are split on purpose.** `tsconfig.json` (web) pins
  `types` to React alone because `@types/node` is present transitively and would
  otherwise hand `web/` `process` and `Buffer`; `tsconfig.server.json` omits
  `dom` so `server.ts` cannot call `document`. Both were verified by probe, not
  assumed. Do not merge them into one config.

## The cascade

Five dependent levels: course → semester → branch → section → subject. It was
wrong three separate times before it was right, and every failure was structural
rather than cosmetic, so the rules are load-bearing. **The rules are in
`web/cascade.ts` and the loop that applies them is in `App.tsx`** — a dropdown
that will not fill is a rule bug, two requests racing is a loop bug.

- **A level is only fetched when a level above it changes.** Auto-filling a level
  does not trigger a refetch, so the loop keeps going on its own while a pass has
  gained something and some level below is ready but empty. Without that second
  condition the chain dead-ends: changing branch clears section and subject, the
  request goes out with no section, the server returns no subjects, section then
  auto-fills to its only option, and the subject list is unreachable because you
  cannot change a single-option dropdown.
- **Every level above the subject auto-fills to its first option.** The chain
  populates itself end to end and the user overrides any level. Earlier this only
  happened for single-option levels, which dead-ended: a level with one option
  cannot be changed, so nothing below it was ever fetched. The subject is the
  one exception and is never auto-chosen, because it decides which register
  loads. The line above the table names the register on screen so a wrong pick is
  visible rather than silent.
- **A newer refresh always wins.** `refreshToken` makes an older in-flight
  request bail rather than write to the DOM.

## Testing

```sh
bunx playwright install chromium      # once
ECAP_USER=... ECAP_PASS=... bun run test
```

**107 of the 110 tests need no credentials and run in about two seconds.** They
cover the portal's seam, its wire conventions, the attendance bands, the route
handlers over a fake portal, and the cascade's rules. Only
`test/smoke.spec.ts` touches the network — and it skips without credentials, so
anything testable without a portal must be.

**Never add an assertion that mirrors the implementation.** Such a test passes
when the code is wrong and proves nothing. Assert a property instead: for the
fast suite, where the line sits and what must never happen across it; for the
smoke test, percentages ascend, the first row is the minimum, the flagged-row
count equals the stat card, and the register on screen is named. Each breaks for
its own distinct reason.

The smoke test drives the real portal because a DOM stub is not sufficient: one
was tried against the previous build and it passed code broken in a real
browser, since it modelled neither `selectedIndex`/`value` coupling nor
`innerHTML` clearing a select's options.

### Proving a test can fail

A test never seen to fail is a decoration. Break the rule it describes, run it,
and confirm the *named* test is the one that turns red. That is how the
`defaultRange` timezone bug was found, how two holes in the cipher tests were
found, and how a session-state test that silently could not fail was caught.
Use a Playwright config without `globalSetup` for the probe, because the lint
gate refuses the deliberate breakage first.

Two traps in that probe, both hit the hard way. **The smoke test drives
`dist/`, not the source**, so a mutation to `web/` needs `bun run build` before it
will be observed — without the rebuild, four mutations "passed". And **a test that
signs in again after `page.goto` cannot see leaked state at all**, because a
reload discards it; inspect state in the same document, or the test passes
whatever the code does.

## Agent skills

### Issue tracker
Issues live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels
Five canonical roles, default strings. See `docs/agents/triage-labels.md`.

### Domain docs
Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

