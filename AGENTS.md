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
easy to forget about.

```sh
Get-Process node,bun,deno,python,go,java -ErrorAction SilentlyContinue
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
```

Reuse what is already there, or stop it before starting a replacement. Never
leave two bound to the same port.

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

**One rule explains this layout: importing `server.ts` boots a server.** So
anything with a decision in it lives in a file that can be imported without one.
That is the whole reason `portal-replies.ts`, `portal-conventions.ts`,
`attendance-bands.ts`, `server-routes.ts` and `web/cascade.ts` exist, and the
whole reason `server.ts` is now mostly HTTP plumbing.

Keep it that way. A network call in any of them makes the fast suite
unreachable, and the fast suite is the only one that runs without credentials —
`test/smoke.spec.ts` **skips** when `ECAP_USER` is unset, so a green run can
check nothing at all. `tsconfig.test.json` lists those five files one by one
rather than as a directory, because `web/` is the DOM+React project and the test
harness is not.

## The front end is Mantine-only

There is no custom CSS in this project: no stylesheet, no CSS module, no inline
`style` prop. Visual decisions are Mantine components, or Mantine colour tokens
read through Mantine's own `bg` and `c` props. If you find yourself wanting a
custom rule, the answer is usually a component prop that already exists — check
`Table.Tr bg`, `Table striped`, `Badge color` before reaching for CSS.

- **The cascade's rules live in `web/cascade.ts`, its loop lives in `App.tsx`.**
  A dropdown that will not fill is a *rule* bug: read `cascade.ts`. Two requests
  racing, or a stale answer winning, is a *loop* bug: read `App.tsx`. Both sets of
  rules are pure functions with tests that run in under a second, so a change to
  either is checked without a portal. ADR 0005.
- **`defaultRange` used `toISOString()` and shipped a 31 December.** Local
  midnight converted to UTC is the previous day east of Greenwich, so every
  reader in IST opened the app a day early. It now builds from local date parts.
  The general trap: `toISOString()` is a UTC conversion, and a date a human means
  is local. Do not reintroduce it.

The Mantine theme is stock, with **one** exception: `fontFamily` is set in
`web/main.tsx` to Scoutie Sans, from `@fontsource-variable/scoutie-sans`. That is
the only `createTheme` call in the project. If you find yourself wanting a second
theme key, stop — the answer is a component prop, the same as above.

`main.tsx` is the single place theme decisions live. Keep it that way, so
"what does this app's Mantine config look like" has a one-line answer.

## React

**While writing front-end code, consult `vercel-react-best-practices` and
`vercel-composition-patterns`.**

## Things that will bite you

- **The portal is a client-side shell.** Its Academic Register page renders no
  dropdowns at all; the page's own JavaScript builds them by calling remote
  methods. There are two different calling conventions and using the wrong one
  returns an empty result with no error. `server.ts` documents both.
- **The password is AES-encrypted client-side before it is posted**, and the
  output is bare ciphertext, base64'd — not the OpenSSL `Salted__` form that
  stock CryptoJS produces. This portal's `JSFiles/jsaes.js` is a custom build.
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
- **`/api/session` answers 200 with `{signedIn: false}`** when signed out, not
  401. Checking the status code alone silently runs the signed-in path.
- **Do not read `event.currentTarget` inside a `setState` updater.** React clears
  it when the handler returns and the updater runs later, so
  `onChange={(e) => setX((x) => ({ v: e.currentTarget.value }))}` throws
  "Cannot read properties of null" the first time anyone types. Read the value
  into a local first. This shipped once and blanked the whole page.
- **Vite hashes asset filenames.** `server.ts` caches `/assets/*` immutably and
  `index.html` not at all; changing that pair reintroduces "my fix did nothing".
- **Every Playwright run lints and typechecks first.** Vite and Playwright both
  use esbuild, which strips types without reading them, so a passing build says
  nothing about types, and nothing else in the toolchain lints at all. Both gates
  live in `test/global-setup.ts`, which Playwright loads for every invocation —
  deliberately not a `pretest` script, which only fires for `bun run test` and
  left `bunx playwright test` able to skip them. See ADR 0002.
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
rather than cosmetic, so the rules are load-bearing:

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

These are the rules in `web/cascade.ts`; the loop that applies them is in
`App.tsx`. Each rule has a test in `test/cascade.spec.ts` that was proven to fail
by breaking it, so a change here is checked in under a second rather than
discovered against a live portal.

## Testing

```sh
bunx playwright install chromium      # once
ECAP_USER=... ECAP_PASS=... bun run test
```

**96 of the 97 tests need no credentials and run in about two seconds.** They
cover the portal's seam, its wire conventions, the attendance bands, the route
handlers over a fake portal, and the cascade's rules. Only
`test/smoke.spec.ts` touches the network.

That ratio is the point. The smoke test skips when `ECAP_USER` / `ECAP_PASS` are
unset, so on a machine without credentials a green run can check almost nothing.
Anything that can be tested without a portal must be.

### Proving a test can fail

A test that has never been seen to fail is a decoration. When you add one,
break the rule it describes, run it, and confirm the *named* test is the one that
turns red. This is not ceremony — it is how the `defaultRange` timezone bug was
found, and it is how two holes in the cipher tests were found (a fixture that
never exercised the `?? ""` guard, and a `not.toContain("Salted__")` assertion
that a salt does not defeat). Run the probe with a Playwright config that omits
`globalSetup`, because the lint gate will refuse the deliberate breakage first.

Every assertion in the fast suite is a property of the rule — where the line sits,
what must never happen across it — not a restatement of how it is computed.

### The end-to-end test

One end-to-end smoke test in `test/smoke.spec.ts`. It signs in to the live portal
and loads a real register, because a DOM stub is not sufficient here: one was
tried against the previous vanilla build and it passed code that was broken in a
real browser, since it did not model `selectedIndex`/`value` coupling or
`innerHTML` clearing a select's options.

Its assertions are properties of the rendered page: percentages ascend, the first
row is the minimum, the flagged-row count equals the stat card, and the register
on screen is named. Each breaks for its own distinct reason. Do not add
assertions that mirror the implementation — they pass when the code is wrong and
prove nothing.

## Agent skills

### Issue tracker
Issues live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels
Five canonical roles, default strings. See `docs/agents/triage-labels.md`.

### Domain docs
Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
