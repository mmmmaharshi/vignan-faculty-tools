# Vignan Faculty Tools

A local, read-only faculty copilot. It reads what the ECAP Portal states about
one faculty member's Sections, and it answers the questions a working day asks:
who is in trouble, which periods have no attendance, what the Portal states
about one student, and when the semester started. The Register is one of its
screens, not the whole.

## Standards

**Always follow the `coding-standards` skill.** It is binding, and it wins over
anything else in this file. `.agents/` is per-clone state, so a fresh clone needs
`bunx skills@latest add mmmmaharshi/skills --skill coding-standards` once, the
same way it needs `bunx vp hooks enable` once.

**Maintainer-facing prose is about the code, never about how we arrived at it.**
Our conversation, the prompt, and the iteration history stay out of code comments,
commit bodies, pull-request descriptions, ADRs, and any other prose a maintainer
reads. A comment explains the code that is present; it does not narrate the
session that produced it, and it does not quote what a model said.

## Communication

**Always respond in `/i-have-adhd` style.** Load the skill and follow it: lead
with the concrete next action, number multi-step work, keep state visible across
turns, and cut tangents. It lives in `~/.agents/skills/i-have-adhd`.

## Commands

```sh
bun install                # once
bun run build              # front end -> dist/
bun server/server.ts       # http://127.0.0.1:8787
bun run dev                # front end AND /api, one Vite process on :5173
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

**`bun run dev` is one process.** `vp dev` serves the front end and runs the
API in the same Vite server, through the `ecap-api` plugin in `vite.config.ts`
(`apply: "serve"`). The plugin turns each `/api/*` request into a `fetch`
`Request` and calls `handleApi`, so there is no second process, no port to
forget, and no proxy. Two things are not obvious:

- **The API core lives in `server/api.ts`, not `server/server.ts`.** Importing
  `server/server.ts` boots a `Bun.serve`, so it cannot be, and is not, loaded
  by Vite. `server/api.ts` holds the portal and `handleApi`; `bun
  server/server.ts` imports it for production,
  the dev plugin imports it for development, and `api/[[...path]].ts` imports
  it for Vercel — the same handler on all three, because the server keeps no
  sessions of its own.
- **There is no server-side session store.** The browser keeps its session in
  localStorage and sends it as the `x-ecap-session` header on every request;
  every answer slides it back. `session-store.ts` and the OS vault are gone
  (ADR 0024). Do not reintroduce server-side session state — it is what would
  break Vercel, where any instance must answer any request.

### Background servers

**Do not start a server. The user starts it.** No `bun server/server.ts`, no
`bun run dev`, no `vp dev`, no background launch on :8787 or :5173 — including "just
to check something". Read the code, ask, or run a test that starts its own.

A server this agent started is a server it then has to remember. It outlives the
task that wanted it, it goes stale the moment the source changes, and it holds a
port the user's own `bun run dev` then fails to bind. In one session it caused three
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
forget. Never leave two bound to the same port. `bun run dev` above is the way to
avoid the whole problem — one process, so there is no second one to forget.

## Layout

```
server/server.ts     Bun HTTP server: static files, routing to api.ts, and Bun.serve
server/api.ts        the API: the portal, createApi(), and the one table mapping a
                     path to its handler; imported by server.ts (prod), the dev
                     plugin in vite.config.ts, and api/[[...path]].ts (Vercel).
                     createApi takes the way to reach ECAP, so the retry rules are
                     testable without one
server/class-routes.ts the cascade's options, the register, and the semester start:
                     every read that comes back from the Academic Register page
server/student-routes.ts one roll number's own page, and the reads its panel needs
                     that the register cannot give it: absent days, the term's
                     counts, and the month table
server/find-routes.ts the Search screen: one roll in, the class ECAP states for it,
                     and that class's report read for the same panel
server/find-scan.ts  the section scan's four outcomes, with its early exit
server/class-resolution.ts the class a profile states, and the inferred-semester flag
server/home-routes.ts the Home screen's reads and the rail's: today's timetable, the
                     day-class-work report, and the signed-in faculty
server/register-levels.ts the five levels a register-shaped request names, and the
                     refusal a missing one earns
server/month-windows.ts one calendar month as the window ECAP reliably answers, the
                     month either side, a month's own first held day, and the
                     twelve-month cap every walk stops at
server/absence-walk.ts the full-semester absences walk, as named outcomes
server/backlog-cursor.ts the backlogs table's one header-to-subject cursor
server/liveness-guard.ts the guard that makes an all-held options request prove
                     the session before it answers
server/static-path.ts the pure containment check for files served from dist/
server/security-headers.ts the headers every answer carries, named once for the
                     local server and the deployed front end both
server/portal-reader.ts what a handler may ask ECAP for, one method per screen
server/http-error.ts the refusal a handler throws, the 401 a dead session earns,
                     and the rule that only a 401 propagates
api/[[...path]].ts   the Vercel function: rebuilds a fetch Request for handleApi
server/portal-liveness.ts alive | dead | unknown: is this ECAP session still working?,
                     and the course list or the refusal that verdict earns
server/portal-conventions.ts the portal's wire conventions: bodies, cipher, cookie jar; no I/O
server/portal-transport.ts how one reply is fetched: the hosts, the two calling
                     conventions, the timeout, and the follow-by-hand redirects
server/portal-signin.ts the sign-in the portal actually wants, and what it answers
server/session-verdict.ts alive | dead | unknown: what /api/session answers, from the
                     liveness probe and the sign-in that tried to revive it
server/portal-html.ts ECAP's reply primitives: the tags, the cell strippers, and the
                     one place a table becomes cell arrays
server/portal-options.ts `<option>` replies, and the placeholder no class names
server/portal-register.ts the register, class and Student Wise grids, and the
                     Cumulative totals
server/portal-student.ts the StudentProfile page: GPA, SGPAs, phones, backlogs, class
server/portal-faculty.ts the faculty name, and the leave grid
server/portal-daywork.ts today's timetable, and the day-class-work report
server/student-class.ts the class a student's own page names, matched to the
                     Portal's own option values
server/attendance-bands.ts the Regular / Irregular / Critical rule, and the summary
web/index.html       Vite entry point
web/fonts.css        the one font-face declaration Scoutie Sans loads through
web/public/offline.html the document the worker serves when a navigation cannot
                     reach the network
web/main.tsx         React root + MantineProvider + the one <SWRConfig> holding
                     the read defaults; the only createTheme call
web/public/manifest.webmanifest  the install prompt's facts: names, start URL,
                     display mode, and the three icons below
web/public/sw.js     the service worker: shell-only cache, /api/* never
                     intercepted; plain JS, so tsc skips it and node --check
                     is the syntax gate. An installed update is offered through
                     the native confirm (`web/data/sw-update.ts`, wired in
                     `web/main.tsx`); yes reloads onto the new shell.
web/public/icons/    the three install icons, rasterized from one SVG tile by
                     a throwaway Playwright script (kept out of the repo)
web/app/             the shell and the session: App.tsx (state, the three modes,
                     and the session's own facts), session-view (the view, the
                     boot check's transition table, and the note it owes the
                     form), route-guard, paths, panel-state, load-gate,
                     load-snap (the one-shot From snap), types.ts (Note, the one
                     shape three modules share)
web/register/        the cascade and its storage: cascade.ts (what auto-fills,
                     when to keep looping, what a change clears, and the names
                     one selection is known by), cascade-run.ts (the loop that
                     settles a selection, and the run a failure left behind),
                     range.ts (the window, its dates, and the start it
                     remembers), worklist.ts (which rows show,
                     their order, the row tint, and the badge words both
                     surfaces share), saved-sections.ts,
                     use-saved-sections.ts (the cards and their three actions,
                     out of App so it stays under the god-file line),
                     absence-list.ts (the panel's one absent list),
                     dashboard-view.ts (the view itself; every load starts it empty),
                     search-scope.ts (the class a searched figure belongs to),
                     sem-start-settle.ts, sem-starts.ts, options-chain.ts (the
                     option chain's one run, and the cache key it answers to),
                     search-result.ts (the Search panel's typed answers)
web/home/            the timetable's memory: today-memory.ts, period-times.ts
                     (the hours each read teaches, and the hook that folds them)
web/data/            the transport and the browser's own storage: client.ts (every
                     fetch the app makes: one JSON wrapper, and the SWR hooks and
                     keys each screen reads through), storage.ts (the one
                     localStorage walk every memory uses), session-epoch.ts (the
                     generation that drops a response landing after sign-out),
                     sw-update.ts, update-lifecycle.ts (the one update offer),
                     format.ts
web/ui/              presentational modules, one per surface (SignInPanel is the
                     sign-in form); only HomePanel holds state,
                     and only its ticking clock — and UnpostedPanel, only which
                     period box stands open, and StudentDetails, only which
                     semester's grade modal stands open — the memories live in App
docs/portal-wire.md  the Portal's per-method contracts: proxy, session marker,
                     parameters in declared order, reply shape, and the traps
                     measured against each. Read it before writing any ECAP call
scripts/portal-probe.ts  one Portal call, measured: prints the signed-in proxy's
                     own declarations, so a parameter name is never guessed;
                     with `logout` it prints the sign-out control instead
scripts/typecheck-staged.ts  the commit hook's typecheck, swallowing the filenames
                     lint-staged appends
shared/api.ts        the server/client contract; both sides import it
shared/portal-values.ts  the rules both runtimes apply to a Portal value, and the
                     campus clock: the bands, the stated percentage, the register's
                     stated start, the attended-of-held cell, the roll comparison,
                     and matching a page's own words to one option
vite.config.ts       build, lint and fmt config; lint from the Cloudflare oxlint
                     preset, fmt from Ultracite, markdown excluded, no rules off
playwright.config.ts test runner config
test/seam.spec.ts    the reply parsers over fixture markup
test/conventions.spec.ts  the wire conventions, the cipher, the cookie jar
test/bands.spec.ts   where the attendance lines sit
test/routes.*.spec.ts  split by topic: the options ladder, the register handler,
                     the student profile and find, the semester-start walks, and
                     the today/unposted handlers - over a fake portal
test/api.spec.ts     handleApi over a header-carried session and a fake portal:
                     what a dead session does, and what a 502 must never do
test/cascade.*.spec.ts  split by topic: the selection rules, the option loop over
                     a fake fetcher, the worklist and its filters, the range
                     dates, and the saved sections
test/client.*.spec.ts   split by topic: the session and its probe, the register
                     and its filters, the student panel and search, the dates a
                     load settles, the dashboard after a reload, and the home
                     screen - over a stub API in the browser
test/support/        the three families' shared harness: the stub API and the
                     mutable `state` the browser tests drive (`client-stub.ts`),
                     the fixture builders (`cascade-harness.ts`), and the fake
                     portal (`routes-fake.ts`)
test/smoke.spec.ts   one end-to-end pass against the live portal
vercel.json          build to dist/, /api/* to the function, the rest to index.html
tsconfig*.json       three projects, split so web/ has DOM and server/ does not
dist/                build output, served by server/server.ts (not source)
```

**One rule explains this layout: importing `server/server.ts` boots a server.**
Anything with a decision in it therefore lives in a file importable without
one, and `server/server.ts` is HTTP plumbing only. A network call in any of
those files makes the credential-free suite unreachable.

- **The semester's class counts come from the Cumulative student-wise register.** The panel's Total Held / Total Attend / Total Absent are the numbers ECAP's Academic Register prints for Student-wise + Cumulative over the semester start through today — the same window that screen uses, and only when the start is known (`studentCumulative` in `server/api.ts`, `readTotals` in `server/student-routes.ts`). ECAP states those three totals as **empty spans** and fills them in the page, so they are counted from the grid the reply does state: one row per day, one cell per period, and a legend the reply carries with it — green Holiday, yellow Absent, red Not Entered, purple No Class Work, and an uncoloured cell attended. Held counts attended + absent + not-entered; a holiday or no-class-work period never ran. The mapping is read from that legend, never assumed: a colour it does not name — or a reply with no legend — leaves the totals absent rather than counting the cell as attended (`parseCumulativeTotals`). This is the one counted figure in the app, and ADR 0026 records why it is narrow; every percentage stays read (ADR 0017). A reply ECAP will not give is no totals, not a failed panel.

- **Dependencies are audited and delayed.** `bun run audit` is `bun audit
  --audit-level high`: it reads `bun.lock`, asks the npm advisory endpoint, and
  fails only on high or critical — low and moderate advisories inside the dev
  toolchain (Vite, Vitest, `launch-editor`) would otherwise make the gate red
  permanently. One low remains today (`deepmerge`, pulled in by `ultracite`,
  blocked by its own range), which is why the level is set rather than the
  default. `bunfig.toml` sets `minimumReleaseAge = "3d"`: a package published in
  the last three days is refused, so a compromised release cannot land before
  the ecosystem notices. When `bun audit fix` offers to cross a major version,
  take it as its own change with the full suite — it bumped `vite-plus` 1.0.0 →
  1.3.0 here, and the `vite` alias above had to move with it.

- **Properties guard the rules examples cannot reach.** Three spec files hold the
  invariants that used to live only in prose: `test/property.state.spec.ts`
  (the redirect guard converges in two hops, a dropped session generation can
  never write again, the load gate never contradicts itself, the panel has no
  illegal transition), `test/property.parse.spec.ts` (a dash is never a figure,
  a blank is never a zero, an impossible percentage is no figure, the cumulative
  counts add up, dates round-trip, the default range is local), and
  `test/property.worklist.spec.ts` (a worklist is a subset of the roster, a
  missing figure sorts last, a bar never admits a row, the cascade keeps what it
  settled). They run on `fast-check`, inside the same Playwright files, so the
  gate is unchanged. Each was mutation-probed: break the rule and the named
  property goes red. The blank-percentage property found a real bug on its first
  run — `Number("")` is `0`, so an unstated figure printed as a failing one, and
  the two register parsers disagreed; they now share `statedPercent`.

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
- **The tabs live once, in `web/ui/NavTabs.tsx`, and both surfaces map
  over them.** `TABS` names every screen's path, label and icon in tab order;
  `RailNav` maps them to stock `Button`s, `BarNav` to `UnstyledButton`s. An icon
  or label change that lands on the rail and misses the bar is a diff that
  ignored the array — the CalendarCheck swap needed two spots before this, and
  that is what the array removes. `activeTab(pathname)` names the highlight,
  defaulting to the register screen: unknown paths render its body before the
  guard sends them on, so the highlight agrees with the screen rather than
  going dark.
- **The header carries the title, and nothing else.** The user name and Sign out
  moved out of it when the rail got wide enough to hold them, and the burger went
  with the drawer it opened (see below).
- **Below `sm` the rail is replaced by a bottom bar, and there is no drawer.**
  `AppShell.Footer` (`hiddenFrom="sm"`) holds the same four screens as one
  `UnstyledButton` each — icon over its label, no fill, a blue icon and a
  semibold label saying which screen. The rail itself is `visibleFrom="sm"`, so
  exactly one navigation is in the accessible tree at any width: a rail
  translated off-canvas is still announced, and two of them also made
  `getByRole("button", { name: "Profile" })` ambiguous. `UnstyledButton` is the
  one Mantine component with no button chrome; the rail's `variant` swap has no
  meaning there, which is why the two surfaces are written differently.
  `test/client.home.spec.ts` pins the single-navigation property.
- **The footer grows by the safe-area inset and pads it away**, and the main
  area pads by the same amount, so the home indicator sits under the tabs rather
  than over them. Both numbers are `env(safe-area-inset-bottom)`, not a guess.
  The footer paints `white` on purpose: the gesture area below the tabs is the
  footer's own padding, so its background is what the phone shows there.
- **Sign out is on the rail above `sm` and on the Profile screen below it.** A
  phone has no drawer, so the screen about the signed-in user is where the way
  out has to be reachable; the Profile copy is `hiddenFrom="sm"` so the two never
  appear together.

## Routing

Four screens, at four paths: `/home` is today's timetable and the landing
screen, `/dashboard` is the cascade and the register, `/profile` is the
profile panel, `/search` is the Student Search screen (one roll
number in, the class ECAP says that student is in, the class report's row for it,
and the profile ECAP holds for it), `/login` is the sign-in form. `/` also renders
the dashboard and the guard sends it on, so it is a second way in rather than a
fifth screen; anything else redirects to `/`. **`App` owns all four** — the
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
- **`bootStep` is the boot check's whole decision.** The effect applies an action
  and keeps none of the phases: waiting, the one retry, and the two ways the boot
  ends are named in one pure table beside `session-view.ts`. Both ends hand over
  through `forgetSession`; only a probe that never answered owes the form a note,
  and the stored credential stays either way — a transport failure may still
  hold a working session. The browser session and reload specs gate the table.

**The selection does not live in the URL.** The path names the screen and nothing
else travels; there are no query parameters. This replaced ADR 0010 and ADR 0011,
both deleted — see ADR 0015 for what it cost. Consequences worth knowing before
you touch the cascade:

- **A register cannot be shared or bookmarked, and a reload starts empty.** The
  path names the screen only, so nothing carries a selection into a new load.
  `/dashboard` always opens on the form with no table: no reply, click, window or
  ticked bar is kept in the browser, so no student rows survive a reload. The
  options are re-read, so a renamed subject still corrects itself. A link to
  `/dashboard` from elsewhere shows the same empty form, which is what keeps a
  register out of a shared URL (ADR 0032).
- **`Load register` is the only way `/api/register` is ever *fetched*.** Nothing
  on the tail of the refresh loop asks for one, and a reload neither fetches nor
  restores one. The smoke test pins this by counting requests on the wire.
- **The selection reaches the request as a value, never through state.** The
  cascade computes a selection before React commits a render for it, so a version
  closing over `sel` would send the previous one. That bug shipped once and said
  "Choose a course first" on a link whose course was plainly set, and its sibling
  read a stale `opts` and sent the wrong batch. `useRegisterLoad(click)` keys on
  the request the handler built, and `runRefresh(seed, known)` is handed both
  values, so neither can happen — a hook cannot close over the selection it is
  keyed by.
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

The measured traps, with their evidence and ADRs, live in `docs/maintenance.md`.
Read that doc before touching the Portal seam, the session, the cascade, the
student panel, the browser calendar, or the toolchain. The rules that change
code today:

- **Portal seam.** Two calling conventions; measure names and markers with
  `bun scripts/portal-probe.ts`; contracts in `docs/portal-wire.md`. The
  password is bare AES ciphertext, not `Salted__`. `Bun.fetch` drops
  `Set-Cookie`, so redirects are followed by hand.
- **Figures are read, never computed.** The one counted cell is the Cumulative
  grid's legend. `Load register` is the only fetch; a reload fetches none.
- **Session.** End it only through `endSession`. A 401 and an empty course list
  evict; a 502 does not. One URL writer, no state in the URL. No student rows
  in localStorage; the credential is in the clear by decision.
- **State and effects.** Pass values rather than a shadowing ref. Read event
  values before a `setState` updater. Dates a human means are local, not
  `toISOString`.
- **Toolchain.** lint → 3-project typecheck → build → tests in
  `test/global-setup.ts`; probe with `bun run test:probe`, which builds first.
  `vp check` is the only lint/format command; the three tsconfigs stay split.
  Never `git push` without permission.

## The cascade

Five dependent levels: course → semester → branch → section → subject. It was
wrong three separate times before it was right, and every failure was structural
rather than cosmetic, so the rules are load-bearing. **The loop lives in
`web/register/cascade-run.ts`, the worklist in `web/register/worklist.ts`** —
`runCascade` asks for
options until a pass gains nothing and no level below a chosen one is still
empty, and `App.tsx` only decides *when* to run it. A dropdown that will not
fill is a rule bug, two requests racing is a loop bug.

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
  cascade loop honest. **The facts table names the register on screen, not the
  picker**: it is built from the request that produced the table, because a
  level changed without pressing Load must keep naming the rows above it — and a
  card naming one class over another class's figures is the exact failure that
  card exists to prevent.
- **A newer refresh always wins, and the signal is what says so.** A change
  aborts the run before it — `cascadeRun` in `App.tsx` — and the run answers
  `null` rather than a settled selection, so an older pass cannot write to the
  screen. It used to be a `refreshToken` counter compared at the end; the abort
  is the same rule with the comparison replaced by the data structure. Both
  halves are load-bearing and both are tested: `runCascade` checks the signal
  before a pass *and* after the reply, so a run already superseded asks the
  Portal nothing and one superseded mid-flight asks no further.

- **A failed run is retried from the picker, not a reload.** With no course
  there is no level to change, so an options error with no way back strands
  the picker in its alert. `Try again` re-runs `runRefresh` from the selection
  on screen, which settles the same way a fresh run does; the button shows
  only while an options error sits, and a run that then starts clears it.
  There is deliberately no blind server-side retry of a judged refusal — the
  single Portal call is 12s, and one revival spends four of those inside the
  60s serverless budget. What
  retries is the cascade loop itself: one stumble per pass is asked again
  before the run fails, because one failed call used to fail all five passes
  behind it. A judged 4xx is answered, never re-asked — the 401 still reaches
  the sign-out sweep at once, and re-asking any judged request cannot change
  its answer. The one exception is a dropped connection: every data read
  shares one retry rule (`withRevival` in `server/api.ts`) — a 401 or a 502
  signs in again once and retries the same read on the fresh portal. A second
  failure signs out or answers as-is instead of buying another revival, and
  a revival never signs anyone out on ambiguity — `test/api.spec.ts` pins
  every half. That single revival is spent even where it cannot cure: a
  genuine ECAP outage or a genuinely empty range answers the same refusal
  after one wasted sign-in and re-read, bounded to the failure path. A run
  that fails after settling keeps what arrived on screen beside the error —
  the course pass 1 fetched is not discarded with the failed branch pass —
  and the retry settles from there.

- **The panel is one state, not two booleans.** `web/app/panel-state.ts` holds
  `open | closing | closed` with the student inside: `closing` is the ~200ms
  slide-out that still draws its row, and only `open` fires the wider
  absent-dates read. `detail` + `detailOpen` was the same fact apart, and a
  read gated on one but not the other fired for a panel already leaving.
- **The Load gate is one state, not three guards.** `web/app/load-gate.ts` answers
  `ready | loading-options | reading-register | finding-start` from the same
  inputs the button and the note read, so the two cannot disagree. The whole
  Register screen waits for that gate through `registerScreenReady`: no saved
  cards, form, summary or table is drawn while options, the start walk or a
  register reply is in flight. Once the screen is up, From already holds the
  class's remembered start; a reader who wants another window types it then.
- **The URL has one steady-state writer.** `web/app/route-guard.ts` (`nextRoute`)
  decides every redirect once the session is known; the back-button effect
  delegates to it. The boot effect keeps its own landing-screen rule (a
  restored session opens Home, and an unknown deep link lands there too) —
  `nextRoute` returns null before boot, so it never competes. `web/app/paths.ts`
  holds the five strings with no JSX, so the guard and the test harness can
  import them, and it also holds `SCREENS` — the four screens in tab order —
  with `isScreen`. `NavTabs.tsx` builds its tabs from `SCREENS` through a
  `Record<Screen, …>` of labels and icons, so a fifth path is a compile error
  until it is named, and the guard cannot keep a path the tabs do not show.
- **A typed To no longer blocks the From snap.** `useSemStartSettle` takes the
  `"" | "from" | "to"` union, not a boolean: only `"from"` suppresses the
  settle-time snaps, so a probe that lands after a typed To still settles
  From. The boolean before it treated both ends as a manual range and dropped
  the answer.
- **`/api/session` is one decision.** `server/session-verdict.ts` maps the
  liveness probe plus the re-auth failure to `alive | dead | unknown`: only a
  401 evicts, a 502 stays unknown (ADR 0013 and 0002). `portal-liveness.ts` still owns
  the probe itself; the verdict owns what the probe plus the re-auth mean.
- **Independent portal reads go out together; dependent ones stay sequential.**
  Reads that need nothing from each other — the register grid beside its
  class report, the profile page beside the absent-dates grid, the class
  report beside the subject listing, the profile's name/photo/designation/leave
  calls beside each other — are asked in one `Promise.all` rather than one
  after another, because a second ECAP round trip spent waiting is the whole
  budget on a serverless function. Everything with a data dependency stays
  sequential: branches after courses, sections after branches, the semester
  walks month by month (each stops at the first dateless month), and the
  section-by-section search keeps its early exit — parallelising that loop
  would read every section on a search the first one already answers.
  `test/routes.today.spec.ts` pins the parallel pairs by holding both reads at a
  gate: a handler that asks one after the other never starts the second.

## The data layer

**Every fetch goes through `web/data/client.ts`, and every read of server data
is an SWR key.** Nothing else in `web/` calls `fetch`. Six endpoints were
hand-rolled effects before this; they are now one wrapper (`getJson` / `postJson`, which turn
a non-2xx into an `ApiError`) and one hook per screen. See ADR 0020.

- **A key is a cache entry, so anything the user must ask for again on purpose
  gets a key that changes per ask.** The register is `[REGISTER_PATH, request,
  attempt]`, where `attempt` is a counter the click increments: every click is a
  load, a repeat click is not a cache hit, and "the click is the only way a
  register is ever fetched" survives the rewrite — `test/smoke.spec.ts` still
  counts the POSTs on the wire. The options chain is the mirror image: one pass
  is cached under the request it answered (`options-chain.ts`), so reopening a
  saved section settles from cache with no Portal calls.
- **A key is a promise about *whose* data it is, so nothing keyed on the server
  survives a session.** `forgetServerData()` sweeps every `/api/` key on the way
  out, and `signedOut` clears the stored session beside it. That sweep is not
  enough on its own: a mutation's failure is the *hook's* own state rather than
  the cache's, so a 401 left in the options chain would sit in the next
  session's class picker — hence `resetCascade()` beside it in `signedOut`.
- **Automatic revalidation is off, except where it is the point, and it is off
  *once*.** `revalidateOnFocus: false`, `revalidateOnReconnect: false`,
  `shouldRetryOnError: false` and `dedupingInterval: 0` are the `<SWRConfig>`
  defaults in `web/main.tsx`, because a read must be something the user asked
  for; a hook adds only what differs. The header's Refresh is the user asking:
  it revalidates every `/api/` key except the register — the click stays the
  only fetch there — and re-settles the cascade where a picker is on screen. Those defaults used to be repeated on every
  hook, five copies of one decision. The two exceptions are deliberate. The
  **session** probe overrides them: `refreshInterval` of `SESSION_PROBE_MS` when
  idle and `0` when a request is in flight or the login screen is up. And the
  **profile** hook keeps SWR's own "revalidate on mount if stale", which is why
  reopening a student's panel shows the last answer at once and refreshes it
  behind the panel — one request on the wire, which fans out to the profile page,
  the Cumulative grid and, per ADR 0029, one class report per month for the month
  table, plus one more only on the **All subjects** path, whose report states no
  dates at all (ADR 0021).
- **A one-shot read is `useSWRImmutable`, and that is the register, the semester
  start and the full-semester absences.** Their keys already say when the answer
  could differ — the click number, the request, the student — so a repeat of the
  same key is the same answer, not a reason to ask again. The two panels keep
  plain `useSWR`: reopening one is a fresh read by design.
- **`focusThrottleInterval: 0` on the session hook.** SWR throttles a focus
  revalidation to 5 seconds by default; the smoke test dispatches one
  `visibilitychange` and expects a probe, so the default would have made the app
  look alive when it was not. The throttle is the subtler of the two: SWR measures
  its window from when the *key* last changed, and `/api/session` never changes,
  so the window is measured from the mount — and a deep link to `/dashboard`
  mounts the hook with focus revalidation already on, which is the case that would
  swallow the probe. `test/client.session.spec.ts` enters that way on purpose.
- **A mutation's callbacks are stable and its state is not, so they are taken
  apart at the call site.** `{ trigger, reset }` are `useCallback(..., [])`; the
  object holding them is rebuilt every render. A dependency on the object re-runs
  every effect that names it, so `App.tsx` destructures.
- **The register read is not allowed to fail the session, and a 502 must never
  sign anyone out.** One effect sweeps `options.error ?? register.error ??
  profile.error` for a 401 into `signedOut`; a 502 sits where it happened. Same
  rules as before the rewrite, in one place instead of four.
- **`session.data` is a fact about the last read, not about now.** `signedIn` is
  deliberately *state*: signing out must be able to say so before the next read
  answers, or the guard drags the user back out of the login screen — the bug
  ADR 0015 removed the second history writer for.

## Testing

```sh
bunx playwright install chromium      # once
ECAP_USER=... ECAP_PASS=... bun run test
```

**Almost every test needs no credentials, and the whole suite runs in seconds.**
Only `test/smoke.spec.ts` touches the network, so everything else — the portal's
seam, its wire conventions, the attendance bands, the route handlers over a fake
portal, the cascade's rules and its option loop over an injected fetcher, the
app's own data layer over a stub API in a real browser, session liveness, and
the retry rules over a fake portal — runs with `bunx playwright test` and no
environment at all, in seconds.

**A stub API can vouch for the app's own data layer, but never for the Portal's.**
`test/client.*.spec.ts` serve the built app and answer `/api/*` in the browser, so
the keys, the click-only register, the probe and the sweep on sign-out are
exercised where SWR actually runs; the shapes it answers with are the app's own
contract, which is all it is testing. What the *Portal* sends is `smoke.spec.ts`'s
job, against the real thing.

**No test count appears in this file, on purpose.** A number here goes stale the
moment a test is added, and a stale count in a manual is worse than none: it
reads as a fact. It was here twice and wrong twice. Read the count off the run.

**Nothing may touch the network except the smoke test**, which is why `api.ts`
takes its way of reaching ECAP as an argument; `test/api.spec.ts` drives the
retry rules over a fake portal and needs no credential at all.

**Never add an assertion that mirrors the implementation.** Such a test passes
when the code is wrong and proves nothing. Assert a property instead: for the
fast suite, where the line sits and what must never happen across it; for the
smoke test, the unfiltered rows are in the Portal's own `Sl.No` order, the
flagged-row count equals the stat card, and the register on screen is named. Each
breaks for its own distinct reason. A probe that passes under the mutation is
not a near miss — it is a test that was never testing anything, and the first
version of `client.session.spec.ts`'s probe test was exactly that: it mounted the app on
`/login`, where the session hook is paused, and so could not see the focus
throttle it was written to pin.

**The register is in roster order; only the filtered table is sorted.** There are
two orders and they are both deliberate, so do not "fix" one into the other. Whole
class, the rows are the Portal's own `Sl.No` order — sorting it lowest-first made
the numbers read as a league table and stopped `Sl.No` running down the page.
With any filter ticked — *All irregular students*, *Below 75%*,
*Below 65%* — the table is a worklist rather than a roster, so it sorts
worst-first: that is the one thing the checkboxes are for. Ticked bars
intersect, so the strictest one wins. Each checkbox names how many rows it
alone would keep, under the current search but ignoring the other ticked
bars: ticking one box never moves another box's count. Subject-bar filters
narrow beneath them without changing the numbers. **The
figure read is the one the path judges by**: the overall percentage on All subjects,
the Subject's own on a subject register — where the overall figure is not read as
a fallback even though it rides the row beside the subject one, and a row admitted
or ordered by one would answer a question nobody asked. **A missing percentage sorts
last**, never first — `null`
is an absence of evidence, and putting such a student at the top of a triage list
sends someone after them for the wrong reason. `registerRows` in
`web/register/worklist.ts`
owns all three rules, which is where they can be pinned without booting a server.

**The All subjects table states one percentage per subject, read from that subject's own report.** The class report states attended counts, never percentages, so each column's figures come from one `ShowSubjectAttendance` read per offered subject, in parallel beside the class report — still one `/api/register` call on the wire. A column whose subject the Portal's own subject list does not offer is dropped rather than guessed; a subject ECAP will not give leaves dashes rather than failing the register; a dead session still signs out, through the same retry the register already has. The cells are read as written — a blank is no figure, never a zero — and they carry no badges and change no band, tint, filter, or sort; the overall percentage stays the one figure that path judges by. Every head label renders on one line; the table scrolls instead of wrapping. Each subject header ticks a threshold for its own column — off, below 75, below 65, then off — and ticked columns intersect like the ticked bars, with a dash clearing none; an empty table names its bar and offers to clear it, since the headers it would be unticked from are gone with it. Settling a class drops bars for subjects it does not offer, so no invisible filter travels with the selection; the bar carries the report's own column heading while the cascade offers the subject list's label, so the two are matched by `matchOption` — the same rule the server reads a reply's words with — never by string equality, which dropped a live bar whenever ECAP spelled one subject differently in the two places. The Overall column reads beside the name in both modes — it is the triage number — and the Roll No column sticks to the scroll edge (`pos="sticky" left={0}`, both Mantine props): positioned beats static, so no z-index exists to set, and the stuck body cells paint the row's own tint or stripe colour so sliding columns hide beneath them instead of ghosting through.

**A typed search is the one filter a new register clears.** A name or a roll was
typed for the class in front of the reader, so carrying it into the next load hides
every row of a register nobody searched — the failure looks like an empty class.
The ticked bars stay, because "show me who is below 75%" is a standing intent that
travels between classes. `loadRegister` in `App.tsx` clears the search and nothing
else, and `test/client.register.spec.ts` pins it.

The smoke test drives the real portal because a DOM stub is not sufficient: one
was tried against the previous build and it passed code broken in a real
browser, since it modelled neither `selectedIndex`/`value` coupling nor
`innerHTML` clearing a select's options.

### Proving a test can fail

A test never seen to fail is a decoration. Break the rule it describes, run it,
and confirm the *named* test is the one that turns red. That is how the
`defaultRange` timezone bug was found, how two holes in the cipher tests were
found, and how a session-state test that silently could not fail was caught.
Use `bun run test:probe -- <spec> -g '<name>'` for the probe: it builds first,
then runs the fast config without `globalSetup`, which the lint gate would
otherwise refuse before the deliberate breakage is tested.

One trap remains. **A test that
signs in again after `page.goto` cannot see leaked state at all**, because a
reload discards it; inspect state in the same document, or the test passes
whatever the code does.

## Agent skills

### Code review
`/code-review` keeps its Spec axis, but its **Standards axis is
`$thermo-nuclear-code-quality-review` on the same diff**, not the skill's own
standards pass. Run one or the other, never both: two maintainability reads of
one diff produce two lists to reconcile, and the stricter one is the one that
finds the restructuring. The `coding-standards` skill still wins where the two
disagree.

After every `$code-review`, run `$thermo-nuclear-code-quality-review`,
`$vercel-composition-patterns`, and `$vercel-react-best-practices` as MUST.
After all code review issues are fixed, then run `$ponytail-audit`.

### Issue tracker
Issues live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels
Five canonical roles, default strings. See `docs/agents/triage-labels.md`.

### Domain docs
Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Prior structural analysis
Deferred decisions and earlier surveys live in `.scratch/untangle-codebase/log.md`
and `pass-2.md`. Read them before starting a structural change; a deferred item
there is a decision, not a missing one.

