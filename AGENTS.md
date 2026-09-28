# Vignan Faculty Tools

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
session-store.ts     sessions in the OS credential vault, over an injected backend
portal-liveness.ts   alive | dead | unknown: is this ECAP session still working?
portal-conventions.ts the portal's wire conventions: bodies, cipher, cookie jar; no I/O
portal-replies.ts    pure string -> data functions, and the seam guards
attendance-bands.ts  the Regular / Irregular / Critical rule, and the summary
web/index.html       Vite entry point
web/main.tsx         React root + MantineProvider; the only createTheme call
web/App.tsx          state, the three modes, and the refresh loop
web/cascade.ts       the cascade's rules: what auto-fills, when to keep looping
web/components/      five presentational modules; none of them holds state
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
test/session-store.spec.ts  session persistence, over a fake vault
test/smoke.spec.ts   one end-to-end pass against the live portal
tsconfig*.json       three projects, split so web/ has DOM and server.ts does not
dist/                build output, served by server.ts (not source)
```

**One rule explains this layout: importing `server.ts` boots a server.** Anything
with a decision in it therefore lives in a file importable without one, and
`server.ts` is HTTP plumbing only. A network call in any of those files makes the
credential-free suite unreachable.

## Routing

Three screens, at three paths: `/dashboard` is the cascade and the register,
`/profile` is the profile panel, `/login` is the sign-in form. `/` also renders
the dashboard and the guard sends it on, so it is a second way in rather than a
fourth screen; anything else redirects to `/`. **`App` owns all three** — the
router is not asked to split it, because that would duplicate the cascade's
state or move it into a context, and ADR 0005 rejected a context for that
reason.

- **`web/main.tsx` has exactly one route, a catch-all rendering `App`.** Do not
  enumerate paths there. Every path used to render the same component, so the list
  was a *second* statement of which path is the dashboard with nothing connecting
  it to `DASHBOARD_PATH` — and when they disagreed the result was a **redirect
  loop**, measured at 37 navigations and 82 API calls in six seconds. It presents
  as a page that never finishes loading rather than as an error. `App` decides
  every path from `pathname === LOGIN_PATH`; a path that only names `App` has no
  business in that file. **The loop only happens while signed in** — signed out
  the guard's first move is `/` to `/login` and it stops, so a check run signed out
  passes against the broken build.

- **The server serves `index.html` for extensionless paths**, or a deep link to
  `/login` 404s before any JavaScript runs. A path *with* a dot is a real file
  request and still 404s, so a broken asset reference is not answered with HTML.
- **The guard has two halves.** The boot check handles deep links. A second effect
  sends a *signed-in* user from `/login` to `/`, because the first only runs on
  mount and Back from a signed-in dashboard lands on `/login` — verified in a
  browser, and it showed the login form to someone who already had a session.
- `booted` and `signedIn` are not screens. They are the two facts the URL cannot
  carry: whether `/api/session` has been asked, and what it said.

**The selection does not live in the URL.** The path names the screen and nothing
else travels; there are no query parameters. This replaced ADR 0010 and ADR 0011,
both deleted — see ADR 0015 for what it cost. Consequences worth knowing before
you touch the cascade:

- **A register cannot be shared or bookmarked, and a refresh starts over.** The
  subject is gone rather than restored, and the cascade refills from the top. The
  dates come back, because `range` starts at `defaultRange()`.
- **`Load register` is the only way `/api/register` is ever called.** Nothing on
  the tail of the refresh loop fetches one, so a register is a decision every
  time. The smoke test pins this by counting requests on the wire.
- **`fetchRegister(levels, dates)` still takes the selection as arguments**, not
  from state. The cascade computes values before React commits a render for them,
  so a version closing over `sel` would send the previous selection. That bug
  shipped once and said "Choose a course first" on a link whose course was plainly
  set. Same class as the `optsRef` one below, from a different direction.
- **The URL-write effect is gone, and that is the point.** It used to compete
  with `signedOut`'s navigation for the history, which is a class of bug that has
  already bitten this app once. Do not add a second writer.


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

**Icons are Phosphor, and Phosphor only.** `@phosphor-icons/react` is the one
icon library, and it is the one Mantine's own documentation uses throughout. It
ships per-icon entry points, so import the icon and not the barrel —
`import { SquaresFour } from "@phosphor-icons/react"` costs about 7kB in the
bundle, while the package is 33MB unpacked. A second icon library is a decision
that needs an ADR, not a `bun add`. Icons are `aria-hidden`: every control that
carries one also has its name in text.

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
- **A session is 30 days of *not using it*, and the cookie's `Max-Age` is derived
  from that** so the two cannot disagree. Longer than the ECAP session by
  design, which is why `/api/session` asks the portal rather than trusting the
  jar: `portal.signedIn` only means "an `frmAuth` cookie is in the jar". A **401**
  evicts, and so does an **empty course list** — see the next rule. A 502 evicts
  nothing, because that one really is ambiguous. ADR 0013.
- **One module decides whether a session is alive: `portal-liveness.ts`.** It
  answers `alive | dead | unknown` and both callers ask it — `handleOptions` and
  the `/api/session` probe. It was written twice, in two layers, and the copy with
  no test coverage is the one that shipped the bug.
- **`unknown` is not `dead`, and a 502 must never sign anyone out.** A signed-out
  request to convention A answers **HTTP 200 with valid JSON** whose `<select>`
  holds only `-Select-` — every sign of life looks good, which is why the check is
  not "did it throw" — and every account has at least one course, so an empty list
  can only mean the session is gone. But a 502 is genuinely ambiguous, and ADR 0002
  and ADR 0013 both refused to treat it as an expiry.
- **A caller needing both the verdict and the options must use `courseVerdict`.**
  Reading `portal.courses()` first and passing the result to `liveness` lets a
  throw escape *before* the rule is reached, so the 502 refusal holds by accident
  rather than by decision. That was the first version; a mutation probe caught it.
- **The store prunes on every write, not only at boot.** A long-running server does
  not boot again, and every sign-in added an entry — seventeen after half an hour
  of test runs, seven of them already dead at the portal. The cutoff is a day: far
  more than ECAP's ~20 minutes, far less than the TTL, and deliberately generous
  because deleting a session that would still work is the worse failure.
- **The 30 days is a ceiling on *our* session, not a promise from ECAP.** A live
  spike proved both portal cookies are session cookies with no `Expires` and no
  `Max-Age`, and that **neither authenticates alone** — so the credential is
  bound to ECAP's in-memory ASP.NET session, and a restored token whose session
  has lapsed is simply signed out. Do not let any UI copy imply otherwise. ADR
  0014.
- **The browser cookie is re-issued on every authenticated response, and it has
  to be.** The server's session slides on use; a cookie written once at sign-in
  does not, so a daily user was signed out on day 31 anyway. `refreshedCookie` in
  `server.ts` is what makes `Max-Age` mean *thirty days from your last use*. Do
  not "simplify" it back to a single write at sign-in.
- **Use `forgetSession(id)`, never `dropSession` followed by a flush.** The delete
  and the write cannot be separated: sign-out shipped calling `sessions.delete`
  without the dirty flag, then without the flush, and a restart inside sixty
  seconds brought the session back. Every call site was free to get it half right
  and one did — `requireSession`, which dropped a 401'd session and left it on
  disk. `dropSession` is the map half alone, for `reapSessions` where the sweep
  writes nothing by itself.
- **`Bun.secrets` cannot be enumerated**, so `VAULT_INDEX` lists the ids and each
  session is its own entry. **One entry for all of them does not work**: Windows
  caps a generic credential at `CRED_MAX_CREDENTIAL_BLOB_SIZE` = 5 × 512 = 2560
  bytes and a session is ~526, so the fifth is rejected with `code 1783` and
  persistence silently stops. Measured, and pinned by a test.
- **Sessions are written before the index, and the index before the orphan
  sweep.** A failure part-way must leave an index that only names entries which are
  actually stored, or a load drops live sessions.
- **Credential Manager is not a process boundary.** A separate process running as
  the same user reads an entry straight back. The vault narrows *at-rest*
  exposure — backups, cloud sync, disk imaging — and nothing else. Do not describe
  it as protecting against a compromised machine; it does not.
- **Restore must happen before `Bun.serve`**, and the top-level `await` is what
  makes that true. `Bun.serve` listens the moment it is called, so a restore after
  it leaves a window where a request finds an empty map and signs a signed-in user
  out.
- **`signedOut(why)` takes a reason, and an empty one means no alert at all.** A
  note object with empty text is *truthy*, so passing `""` rendered an empty
  alert under the sign-in form. The sign-in form now shows **nothing** unless
  there is something to say: a deliberate sign-out is silent, and a session that
  died while you were working explains itself. Both halves have a mutation check
  — assert on `getByRole("alert")`, which counts the box, not its text, because
  the bug being guarded is precisely an alert with *no* text.
- **There is exactly one writer of the URL, and it is not an effect.** The
  selection used to be written back by an effect, and it and `signedOut`'s
  navigation were competing history writers: signing out navigated to `/login`
  and was immediately dragged back to `/`. The selection is no longer in the URL
  (ADR 0015), which is what removed the second writer. If anything starts writing
  the address bar again, that bug is the one to expect.
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

**128 of the 139 tests need no credentials and run in about six seconds.** They
cover the portal's seam, its wire conventions, the attendance bands, the route
handlers over a fake portal, the cascade's rules, session liveness, and session
persistence over a fake vault. Only `test/smoke.spec.ts` touches the network — and
it skips without credentials, so anything testable without a portal must be.
**Nothing may touch the real Windows Credential Manager**, which is why
`session-store.ts` takes its backend as an argument; `bunSecrets()` is the only
caller of the real thing.

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

