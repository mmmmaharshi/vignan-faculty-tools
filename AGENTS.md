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
bunx vp run --parallel dev:all   # dev server AND api, one process to stop
bun run dev                # Vite alone on :5173
bun run typecheck          # tsc over all three projects - see the trap below
bun run lint               # vp check: oxfmt + oxlint, no writes
bun run lint:fix           # vp check --fix: writes
```

`vp` is Vite+'s CLI and is the only toolchain entry point now: `vp dev`,
`vp build`, `vp check`, `vp pack`. **`vp dev` and `vp test` are Vite+ built-ins;
`vp run dev` and `vp run test` are the project's own scripts.** There is no
Vitest here — the suite is Playwright — so `vp run test` is the test command.

**There is no `prepare` script, on purpose.** The migrator added
`prepare: vp config`, and it breaks `bun install --production`: devDependencies
are absent there, so `vp` is not on PATH and the fallback tries to download a
Node.js runtime, which fails and takes the whole install with it. `core.hooksPath`
and `.vite-hooks/_` are per-clone state, so a **fresh clone needs
`bunx vp hooks enable` once** — that is the only thing `prepare` was buying.

**`dev:all` is the dev command, and `--parallel` is what makes it work.** It is
`api` plus `vp dev` from one task, so one Ctrl-C stops both. Two things are not
obvious:

- **`--parallel` is required.** Without it the `dependsOn: ["api"]` edge gates
  correctly, and since `server.ts` never exits, `vp dev` never starts — verified:
  without the flag only :8787 comes up. `--parallel` ignores the edge and runs
  both at once.
- **The task cannot be named `dev`.** A task and a `package.json` script cannot
  share a name, and `dev` is already a script. Hence `dev:all`.

Do not replace this with `&` inside one `command`. The task runner splits on `&`
and execs each side **sequentially**, so the second never starts; `start /b` is a
cmd builtin it cannot exec. Nor hand-roll a `Bun.spawn` launcher: `vp` on Windows
re-execs `node`, so `kill()` signals the shim and the real dev server survives as
an orphan holding :5173. The task runner reaps both — verified by stopping the
runner and watching both ports free.

### Background servers

**Do not start a server. The user starts it.** No `bun server.ts`, no
`dev:all`, no `vp dev`, no background launch on :8787 or :5173 — including "just
to check something". Read the code, ask, or run a test that starts its own.

A server this agent started is a server it then has to remember. It outlives the
task that wanted it, it goes stale the moment the source changes, and it holds a
port the user's own `dev:all` then fails to bind. In one session it caused three
false diagnoses — a changed band threshold, a changed option list and a changed
column header each read as a broken edit, because the page was being served by a
process that had been running since before the change. **Bun loads its modules at
boot and never reloads**, so a stale process answers correctly on every field
except the one that changed, which is the least recognisable failure there is.

**Do not kill one either.** Stopping the user's server to free a port is the same
mistake pointed the other way.

If something genuinely needs a server up, say so and let the user start it. To
see what is already running:

```sh
Get-Process node,bun,deno,python,go,java -ErrorAction SilentlyContinue
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
```

A second start fights the first for the port: the older process keeps serving
stale code while the new one dies on a bind error, and the leftover is easy to
forget. Never leave two bound to the same port. `dev:all` above is the way to
avoid the whole problem — one process, so there is no second one to forget.

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
web/cascade.ts       the cascade's rules: what auto-fills, when to keep looping,
                     what a change clears, and the saved classes in storage
web/components/      six presentational modules; none of them holds state
web/types.ts         Note, the one shape three modules share
shared/api.ts        the server/client contract; both sides import it
vite.config.ts       build, lint and fmt config; both blocks come from the
                     Ultracite preset, 15 rules off, markdown excluded
playwright.config.ts test runner config
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

## The rail

The sidebar holds navigation, the signed-in user's name, and **Sign out**. The
cascade and the register are in the main area — the rail was 320px when it held
five dropdowns, and "Information Technology" truncated to "Infc" in it, so the
control that names the class you picked was the one you could not read.

- **It is 300px wide, and 300 is Mantine's own number** — the width in the
  canonical `AppShell` example in Mantine's documentation. There is no token for
  it: `theme.spacing` tops out at `xl: 32`. Do not "tidy" it to a rounder-looking
  280 or 320 without a reason; the number is borrowed, not chosen.
- **Layout is `AppShell.Section` plus `Stack`, never margin.** The first section
  takes `grow` so the second sits on the bottom of the rail; `Stack gap="xs"` is
  the gap between the buttons. Mantine already provides both mechanisms.
- **The buttons are `Button` with `variant` and `aria-current` swapped from
  `pathname` on every render.** `Button` has no `active` prop, so the current
  screen is a variant, and it cannot drift from the URL. `fullWidth` and
  `justify="flex-start"` are the only other props — the rail looks the way it
  looks because it is stock components with stock props.
- **The header carries the burger and the title, and nothing else.** The user
  name and Sign out moved out of it when the rail got wide enough to hold them.

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
- **There are two calling conventions, and a third trap inside the second one.**
  `ShowAcademicCalendar` (Academic Register) and `ShowAllAttendance` (Class
  attendance report) are both invoked through the **generated-proxy** convention:
  a `.ashx` file named for the page and its code-behind, a `_method=` query
  parameter, and a body of `key=value` lines joined by `\r\n` with `%` escaped to
  `%26` and `=` to `%3D`. Two things about that shape cost real time:

  - **The proxy declares the parameter names, and they are Pascal-cased.** The
    page's own JavaScript calls `main.FillLinks(id, fname, menuHeading)` but the
    proxy declares `ModuleId, ParentFolder, MenuHeading`. Sending the camel-cased
    names returns `Object of type 'System.DBNull' cannot be converted to type
    'System.Int32'` — not an empty list. **Read the proxy definition; it is
    served as a `<script src>` on the page and is the only place the exact
    contract exists.**
  - **The `_session=` marker is per method, not per convention.** `FillLinks`
    wants `rw`; `ShowAllAttendance` and `ShowAcademicCalendar` want `no`. The
    wrong value gives a bare `NullReferenceException` with no parameter name in
    it.

  Reaching `ShowAllAttendance` through the **JQuery** convention fails
  differently: it answers a generic `500` while other methods on the same
  endpoint work fine. `LoadBranchAndSemestersDropDown` is one of those — it lives
  on the `AjaxGeneral` proxy and 500s on `jqmethods.aspx`, which is why the
  branches-and-semesters call is the one that looks broken and is not.

- **`ShowAllAttendance` is the Class attendance report, and it honours any date
  range.** It takes thirteen values, all sent every time: course, branch,
  semester, section, from date, to date, then the four labels, then three flags
  of which all are always false (`isJNTUFormat`, `onlyhostelrs`,
  `excludeothersubjects` — the last must be false or the report spans one subject
  instead of the section). **The Portal has no semester start date to give**:
  `GetDates` returns month-to-date and the report's date pickers carry no
  bounds, so the user's chosen range is the definition of the period.

- **Attendance figures are read, never computed.** Both the subject register and
  the class report state their percentages, and the app displays those. The
  combined attended-of-held cell is never split. Measured against a real
  section, the class report's declared cell agreed with the sum of its own
  subject columns 69 of 69 — which is precisely why it must not be recomputed.
  See ADR 0017.

- **A failing class report must never fail the register.** On the subject path it
  is allowed to fail: the register renders with the overall column absent. On the
  **All subjects** path it *is* the register, so an empty one is a named 502. The
  two paths have opposite failure rules on purpose.

- **`Load register` is still the only thing that fetches a register.** The class
  report is read *inside* that one request, so the smoke test that counts
  `/api/register` POSTs on the wire is unchanged by all of this.

- **A saved class is a Subject in a Section: five values, and no Portal call.**
  `Save this class` writes them; a card above the class form fills the five
  dropdowns and nothing else. There is no dashboard and no per-subject fetch —
  one was built and removed, and ADR 0016 records why. **A Section has no
  statistics of its own**, which is why the summary cannot be a section row.
  See `docs/adr/0016-the-saved-class-opens-the-register-it-names.md`.

- **A subject's name is stored as a cache, never as the answer.** The label the
  cascade offers wins whenever this session has offered that section's subjects, so
  a renamed subject corrects itself on the card's next open; the stored one covers
  only cards this session has not opened. Without it every card reads blank until
  opened once per browser session, which is the worse trade — amendment 3 of ADR
  0016. **A name key is `section` + `subject`, not the value alone**: subject codes
  are short and repeat across branches, so a value-only key hands a card the name
  of the same code in another section. The key is display-only and never stored,
  so it is cleared with `saved` on sign-out rather than left for the next user.

- **`resetFor` is why opening a card keeps its subject.** A section change
  invalidates everything below it, so opening a card with "the section changed"
  discarded the very subject the card names — and auto-fill then took the first
  subject entry, which is `ALL SUBJECTS`. A change that **arrives carrying a
  selection** clears nothing below it; one made by hand still clears the subject.
  It lives in `cascade.ts` rather than the component because a rule that cannot be
  imported without booting a server cannot be tested, and this one shipped wrong
  twice before it was.

- **A comment is not a dependency list.** The dashboard effect's comment said the
  trigger was the section while its dependencies named all five levels, so choosing
  a Subject re-read every subject in the section. The class of bug is a rule
  stated in prose and implemented differently, with nothing to notice.

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

- **The index is a credential too, so it needs its own budget.** Going one entry
  per session solves the cap *per session* and reintroduces it *per index*: the
  index grows about 39 bytes a session, so it fills after roughly **65 sign-ins
  inside the 24-hour staleness window**, and the next write fails with the same
  `code 1783` — silently, because the caller only logs the message. This was
  live: 65 sessions, a 2536-byte index, and a sign-in that would not persist.

  `withinIndexBudget` in `session-store.ts` bounds the index to
  `INDEX_BYTE_BUDGET` (2048), keeping the **most recently used** sessions and
  dropping the oldest past that point, then deletes the dropped sessions' entries
  so none is orphaned. The cap is on bytes actually measured, not on a count, so
  it stays right if the id shape ever changes. Two tests pin it: 200 sessions
  still produce an index under 2560 bytes with the newest surviving, and 20
  still survive untouched. **The pre-existing test that claimed to cover this
  used 20 sessions, where 780 bytes looks fine — a test named for a limit and
  stopping an order of magnitude short of it.**

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
  out. This is also what makes **`bun --watch` safe** for the dev task: the
  restart drops every in-memory session, and the restore puts them back, so
  saving a file does not sign anyone out.
- **The dev API hot-reloads; the Playwright one does not.** `dev:all` runs the
  `api` task as `bun --watch server.ts`, so a change to anything the server
  computes — a band threshold, an option list, a summary figure — is live on the
  next request, same as the front end. Measured: a one-line edit changed the
  listening process and re-printed the banner. Two things follow, both learned
  the hard way. `bun server.ts` on its own **does not** watch, and Playwright's
  `webServer` deliberately does not either, so anything started that way still
  needs a manual restart. And because a stale process answers correctly on every
  field except the one that changed, it reads as a broken edit rather than a
  stale server — it did, three times in one session.
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
- **Every Playwright run lints, typechecks, then builds — in that order.** The
  bundler and Playwright both strip types without reading them, so a passing
  build says nothing about types, and nothing else in the toolchain type-checks.
  All three live in `test/global-setup.ts`, which Playwright loads for
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
- **`lint.options.typeAware` and `typeCheck` are off, on purpose.** Vite+ enables
  both by default, and tsgolint then type-checks every file against **one**
  tsconfig. That cannot work here: the three-project split above is the whole
  point, and a single project either hands `web/` the server's globals or takes
  the server's away — `Bun` and `import.meta.dir` vanish from `server.ts`, and
  `toSorted` vanishes from the tests. It reported 213 errors on code `tsc`
  accepts. Type checking is `bun run typecheck`, which is still in the gate.
- **`vp check` is the only lint and format command.** `oxlint.config.ts` and
  `oxfmt.config.ts` are gone: Vite+ disables nested lint and format configs, so
  a file Oxlint never reads is a file that silently stops applying. Their content
  is in the `lint` and `fmt` blocks of `vite.config.ts`.
- **`overrides.vite` is a bare key, and that is deliberate.** The migration rules
  want `vite@*` under pnpm, because a bare key matches a `catalog:` reference and
  `vp up` then rewrites it to a concrete version. This project is Bun with no
  catalogs, so there is no `catalog:` to rewrite and the bare key is inert.
  Adding `vite@*` alongside it is not a fix: `vp migrate` re-adds `vite` on every
  run, so the two keys coexist and fight over the same spec. Re-key it in the
  same change that moves this to pnpm.
- **The commit hook is `vp check --fix`, so it does not typecheck.** `staged` maps
  `**/*` to `vp check --fix` and nothing else, which means format and lint only.
  Type checking happens in `test/global-setup.ts` and nowhere in the commit path,
  so a type error is found by `vp run test`, not by `git commit`. Do not add
  `tsc` to the `staged` block: ADR 0012 rejected a second copy of the gate for
  exactly this reason, and the array form of `staged` runs each entry as its own
  command, so `["tsc", "-p", "tsconfig.json"]` would execute `-p` on its own.
- **`"**/*"` in the `staged` block, not `"*"` and not a file-type list.** The
  unanchored `*` happens to reach subdirectories today, but only because
  lint-staged matches on basename; `**/*` says what is meant. It also leaves the
  unstaged files alone — verified by staging one badly formatted file next to
  another, and only the staged one came back rewritten.

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
- **Every level auto-fills to its first option.** The chain populates itself end
  to end and the user overrides any level. Earlier this only happened for
  single-option levels, which dead-ended: a level with one option cannot be
  changed, so nothing below it was ever fetched. **The subject is no longer the
  exception.** It used to be left empty, on the grounds that it decides which
  register loads; that is now carried by `All subjects` leading the list, so the
  auto-fill lands on the section-wide view and the user narrows from there. A
  section with no subjects at all still leaves it empty, which is what keeps the
  cascade loop honest. The line above the table names the register on screen so
  a wrong pick is visible rather than silent.
- **A newer refresh always wins.** `refreshToken` makes an older in-flight
  request bail rather than write to the DOM.

## Testing

```sh
bunx playwright install chromium      # once
ECAP_USER=... ECAP_PASS=... bun run test
```

**Almost every test needs no credentials, and the whole suite runs in seconds.**
Only `test/smoke.spec.ts` touches the network, so everything else — the portal's
seam, its wire conventions, the attendance bands, the route handlers over a fake
portal, the cascade's rules, session liveness, and session persistence over a fake
vault — runs with `bunx playwright test` and no environment at all, in seconds.

**No test count appears in this file, on purpose.** A number here goes stale the
moment a test is added, and a stale count in a manual is worse than none: it
reads as a fact. It was here twice and wrong twice. Read the count off the run.

**Nothing may touch the real Windows Credential Manager**, which is why
`session-store.ts` takes its backend as an argument; `bunSecrets()` is the only
caller of the real thing.

**Never add an assertion that mirrors the implementation.** Such a test passes
when the code is wrong and proves nothing. Assert a property instead: for the
fast suite, where the line sits and what must never happen across it; for the
smoke test, the unfiltered rows are in the Portal's own `Sl.No` order, the
flagged-row count equals the stat card, and the register on screen is named. Each
breaks for its own distinct reason.

**The register is in roster order; only the filtered table is sorted.** There are
two orders and they are both deliberate, so do not "fix" one into the other. Whole
class, the rows are the Portal's own `Sl.No` order — sorting it lowest-first made
the numbers read as a league table and stopped `Sl.No` running down the page.
With *Show only irregular students* ticked, the table is a worklist rather than a
roster, so it sorts worst-first: that is the one thing the checkbox is for. **The
figure read is the one the table shows**, so on All subjects it sorts by the
overall percentage, and **a missing percentage sorts last**, never first — `null`
is an absence of evidence, and putting such a student at the top of a triage list
sends someone after them for the wrong reason. `registerRows` in `web/cascade.ts`
owns all three rules, which is where they can be pinned without booting a server.

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

