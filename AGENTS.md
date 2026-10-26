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
server/api.ts        the API: the portal and createApi(); imported by server.ts
                     (prod), the dev plugin in vite.config.ts, and
                     api/[[...path]].ts (Vercel). createApi takes the way to
                     reach ECAP, so the retry rules are testable without one
server/server-routes.ts the two route handlers, over a PortalReader; no HTTP in it
api/[[...path]].ts   the Vercel function: rebuilds a fetch Request for handleApi
server/portal-liveness.ts alive | dead | unknown: is this ECAP session still working?
server/portal-conventions.ts the portal's wire conventions: bodies, cipher, cookie jar; no I/O
server/portal-replies.ts pure string -> data functions, and the seam guards
server/attendance-bands.ts the Regular / Irregular / Critical rule, and the summary
web/index.html       Vite entry point
web/main.tsx         React root + MantineProvider + the one <SWRConfig> holding
                     the read defaults; the only createTheme call
web/public/manifest.webmanifest  the install prompt's facts: names, start URL,
                     display mode, and the three icons below
web/public/sw.js     the service worker: shell-only cache, /api/* never
                     intercepted; plain JS, so tsc skips it and node --check
                     is the syntax gate
web/public/icons/    the three install icons, rasterized from one SVG tile by
                     a throwaway Playwright script (kept out of the repo)
web/App.tsx          state, the three modes, and the session's own facts
web/client.ts        every fetch the app makes: one JSON wrapper, and the SWR
                     hooks and keys each screen reads through
web/cascade.ts       the cascade's rules: what auto-fills, when to keep looping,
                     what a change clears, and the loop that settles a selection
web/saved-classes.ts the saved classes in storage, and the branch initialism
                     on their cards
web/worklist.ts      the register worklist: which rows show, their order, the
                     row tint, and the badge words both surfaces share
web/components/      eleven presentational modules; only HomePanel holds state,
                     and only its ticking clock — the memories live in App
web/types.ts         Note, the one shape three modules share
shared/api.ts        the server/client contract; both sides import it
vite.config.ts       build, lint and fmt config; both blocks come from the
                     Ultracite preset, 15 rules off, markdown excluded
playwright.config.ts test runner config
test/seam.spec.ts    portal-replies over fixture markup
test/conventions.spec.ts  the wire conventions, the cipher, the cookie jar
test/bands.spec.ts   where the attendance lines sit
test/routes.spec.ts  the options ladder and the register handler, over a fake portal
test/api.spec.ts     handleApi over a header-carried session and a fake portal:
                     what a dead session does, and what a 502 must never do
test/cascade.spec.ts the cascade's rules, and its option loop over a fake fetcher
test/client.spec.ts  the data layer, over a stub API in the browser
test/smoke.spec.ts   one end-to-end pass against the live portal
vercel.json          build to dist/, /api/* to the function, the rest to index.html
tsconfig*.json       three projects, split so web/ has DOM and server/ does not
dist/                build output, served by server/server.ts (not source)
```

**One rule explains this layout: importing `server/server.ts` boots a server.**
Anything with a decision in it therefore lives in a file importable without
one, and `server/server.ts` is HTTP plumbing only. A network call in any of
those files makes the credential-free suite unreachable.

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
- **The tabs live once, in `web/components/NavTabs.tsx`, and both surfaces map
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
  `test/client.spec.ts` pins the single-navigation property.
- **The footer grows by the safe-area inset and pads it away**, and the main
  area pads by the same amount, so the home indicator sits under the tabs rather
  than over them. Both numbers are `env(safe-area-inset-bottom)`, not a guess.
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

- **The portal is a client-side shell.** Its Academic Register page renders no
  dropdowns at all; the page's own JavaScript builds them by calling remote
  methods. There are two different calling conventions and using the wrong one
  returns an empty result with no error. `api.ts` documents both.
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

- **The Date Range count is read from the register's own date columns, never
  subtracted.** `ShowAcademicCalendar` lays one column per day the subject met —
  10/10 to 16/10 for a 01/10–16/10 range, with Sunday 11/10 simply absent — so
  `registerDates` counts those headers and the summary carries the figure as
  `classesHeld`. The frame count travels beside the Date Range label only
  where the Portal stated its days. The class report aggregates by subject
  and states no dates, so All subjects shows the bare range.

- **Attendance figures are read, never computed.** Both the subject register and
  the class report state their percentages, and the app displays those. The
  combined attended-of-held cell is never split. Measured against a real
  section, the class report's declared cell agreed with the sum of its own
  subject columns 69 of 69 — which is precisely why it must not be recomputed.
  See ADR 0017.

- **A failing class report must never fail the register.** The subject path shows
  no overall column at all, so a failed report changes nothing visible there. On the
  **All subjects** path it *is* the register, so an empty one is a named 502. The
  two paths have opposite failure rules on purpose.

- **`Load register` is still the only thing that fetches a register.** The class
  report is read *inside* that one request, so the smoke test that counts
  `/api/register` POSTs on the wire is unchanged by all of this.

- **A student's GPA, semesters, phone numbers and backlogs are a third Portal
  screen, read once per open.** The register states none of them, so `Show Details`
  asks `/api/student` for that one roll number, through the `StudentProfile` proxy
  and `ShowStudentProfileNew`. **It is the one method here that wants
  `_session=rw`**, not `no` — the wrong marker is a bare
  `NullReferenceException` with no parameter name in it — so the marker is a
  field of the remote rather than a constant inside `#webMethod`. It is not read
  with the register: that would be one Portal call per row, on load.
  `parseStudentProfile` anchors on `divProfile_BioData`, so a reply without it is
  a 502, while a student whose page states `CGPA: NA` and no numbers is an answer
  the panel states in words. **The backlogs table is on that same page and its
  data row is never closed** — it and the `Total backlogs` row arrive as one
  `<tr>` — so `parseStudentBacklogs` reads the cells in order rather than by row,
  the same defect as the unclosed SGPA row. The red `*` it puts before a subject
  is kept as written: the page says nowhere what it means. A page with no
  backlogs either says so in words (`Student have no backlogs`) or leaves the
  section empty, and those are different answers — the words are shown, the empty
  section is not.

- **The All subjects panel's absent dates are one more Portal answer, not a
  Monday-to-Friday subtraction.** The class report aggregates by subject and
  states **no dates at all** — its header is `Sl.No | Roll.No | Student Name |
  <subjects> | Total | Percent`, and its own page's All / Monthly / Period modes
  are all that same method, none of them day-wise. The only answer that lays
  per-day columns for a whole section is the register page's **Student Wise**
  mode: `ShowAcademicCalendar_StudentWise(rollNo, …, fromdate, todate)`, one row
  per subject and one column per day the section met, one mark per period inside
  a cell. It is asked for **only** when the register on screen is the All subjects
  view, inside the `/api/student` read the panel already makes — one call per
  panel open, never with the register. Three traps: its wire names are
  **lower-cased** where the subject register's are Pascal-cased, and the wrong
  case is the bare `Object of type 'System.DBNull' cannot be converted to type
  'System.String'` rather than an empty report; its `_Cumulative` sibling states
  no dates; and its reply is not the profile page, so a reply that is not that
  grid is `null` — stated as nothing, never as a clean sheet. `parseStudentAbsences`
  reads the union of the `A` cells in the grid's own date order, and ADR 0021
  records why the panel pays one call instead of sixteen.

- **The All subjects view names the probed first day, and nothing else, to stand
  in for its missing start date.** `ShowAllAttendance` states no dates, so the
  facts card asks `/api/sem-start` for the first offered subject's own register
  over the same range and prints its first day as `Sem Start Date`. The From
  input snaps to it and the Date Range fact starts from it, exactly as
  `statedFrom` does on the subject path. One extra call per All subjects load,
  never on a subject register (whose own grid already states its days); a probe
  that fails changes nothing, except a 401, which still signs out. The row
  names the earliest start day ever seen for that class (remembered per class
  in `localStorage`, keyed by the five levels plus the Portal's batch title),
  so a later From moves the figures but never the row. See ADR 0022.

- **A panel shows one absent list: the full semester's.** The Portal states only
  the days inside the window, so the panel reads the **same** read again over
  the remembered start and shows that answer alone — never the window's dates
  beside the semester's. No new kind
  of Portal call: the subject path reads the same register grid, the All
  subjects path the same Student Wise grid. Asked only when the window starts
  after the remembered start — when they coincide the window's own dates are
  shown as the one list, with no wider read behind them. Gated on
  the drawer being open, not on a student being set: `detail` survives the
  ~200ms slide-out by design, and a register loaded in that window must not
  read for a panel that is already leaving. On the subject path the wider list
  is that subject's alone and its title says so; a wider read ECAP would not
  give says so on the panel rather than passing for "no absences in the
  semester". See ADR 0022.

- **A faculty member's leave counts are one more ECAP screen, read with the
  profile.** The ACADEMICS menu's LEAVES → APPLY-SELF page answers them through
  its `showLeaves` proxy method (`_session=r`, no parameters), which states
  `Leave Type | Eligible | Applied | Approved | Pending | Declined | Available`
  per leave type. `parseLeaveStatus` picks that grid by its header and takes the
  number at the front of each count cell, because the Portal never closes the
  Approved cell's div. A grid that will not load is no counts, not a failed
  profile: the name and photo still answer the screen. See ADR 0023.

- **The GPA is the Portal's own line, printed as it stands.** `CGPA: 5.61
  Credits:16/19 48.55 %` is one sentence on the page, and the percentage beside
  it is read the same way the attendance columns are — never recomputed from the
  credits. A student with no past semesters has the page's `NA`, which is not a
  zero, so the line stays with `NA` on it rather than being dropped.

- **An SGPA is read by its column, never as its row's last cell.** The page
  states one SGPA per past semester, on the row beginning `Grade`, in the column
  its own header calls `SGPA` — and the Portal **never closes that row**, so the
  row a reader finds there carries the Credit row's cells too and its last cell is
  `16/19`. Last-cell reading prints the credit total where `5.61` belongs, which
  is why `sgpaBySemester` locates the column first; the semester name comes from
  the `Semester` span above that table, not from the last span on the page.

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

- **A comment is not a dependency list.** The dashboard effect this replaced said
  its trigger was the section while its dependencies named all five levels, so
  choosing a Subject re-read every subject in the section. The class of bug is a
  rule stated in prose and implemented differently, with nothing to notice. The
  cascade's version of that rule is `shouldContinue`, which is a function with its
  own tests rather than a comment beside an effect.

- **End a session through `signedOut`, never a bare `setSignedIn(false)`.** A 401
  only fires when something asks the server for something, so a user who leaves a
  register open comes back to numbers from a session that no longer exists. The
  probe — `refreshInterval: SESSION_PROBE_MS` on the session key — covers that;
  `signedOut` covers the rest, because flipping the flag changes the screen while
  the previous session's answers are still readable, in the cache *and* in a
  mutation's own state. Signing back in then produced a table already narrowed by
  a choice made against a session that no longer existed.
- **A session is 30 days of *not using it*, and the stored `at` is what slides.**
  Every answer carries the session back with a fresh `at`, so a daily user is
  never signed out on day 31. Longer than the ECAP session by design, which is
  why `/api/session` asks the portal rather than trusting the jar:
  `portal.signedIn` only means "an `frmAuth` cookie is in the jar". A **401**
  drops the stored session, and so does an **empty course list** — see the next
  rule. A 502 drops nothing, because that one really is ambiguous. ADR 0013.
- **A refusal carries no session header, and the browser drops what it holds.**
  `read()` in `web/client.ts` saves the session only when an answer carries
  one; `signedOut` in `App.tsx` clears storage beside the cache sweep. There is
  no server-side eviction because there is nothing server-side to evict — a 401
  from signing in is about the password just typed, and any other 401 is about
  the session the request carried.
- **The ECAP password lives in localStorage in the clear.** Deliberate,
  user-accepted: it is what lets the server keep nothing and still revive a
  dead portal session without asking again. Anyone holding the browser's
  storage holds the ECAP account with it. Do not log it, print it, or widen
  where it travels — it already goes on every request, which is exactly enough.
- **There is deliberately no login rate limiter.** A limiter that works needs a
  shared store once more than one instance serves traffic, and an in-memory one
  on a serverless function silently becomes per-instance — false confidence. The
  attempts proxy straight to ECAP, whose own lockout policy is the real gate.
  Do not add one without a store both runtimes share.
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
- **The 30 days is a ceiling on *our* session, not a promise from ECAP.** A live
  spike proved both portal cookies are session cookies with no `Expires` and no
  `Max-Age`, and that **neither authenticates alone** — so the credential is
  bound to ECAP's in-memory ASP.NET session, and a rebuilt jar whose portal
  session has lapsed is simply signed out. Do not let any UI copy imply otherwise.
  ADR 0014.
- **A server restart signs out nobody.** The session lives in the browser, not
  the process, so `bun --watch server/server.ts`, a dev restart, and a Vercel cold
  start all keep the user signed in — the next request rebuilds the portal from
  the stored session and revives it if ECAP dropped it.
- **The dev API reloads with the dev server; the Playwright one does not.**
  `server/api.ts` is an import of `vite.config.ts`, which Vite watches: a change
  to it (or to `server/server-routes.ts` behind it) restarts the Vite dev
  server, so a band threshold, an option list or a summary figure is live on
  the next request, same as the front end. Two things follow, both learned the
  hard way. `bun server/server.ts` on its own **does not** watch, and
  Playwright's `webServer`
  deliberately does not either, so anything started that way still needs a
  manual restart. And because a stale process answers correctly on every field
  except the one that changed, it reads as a broken edit rather than a stale
  server — it did, three times in one session.
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
- **Vite hashes asset filenames.** `server/server.ts` caches `/assets/*`
  immutably and `index.html` not at all; changing that pair reintroduces "my
  fix did nothing".
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
- **Nothing in the cascade reads state from a closure any more, and that is the
  fix.** `runRefresh` used to be memoised with `[]`, so it closed over render 1
  and anything reading `sel` or `opts` had to go through `selRef` / `optsRef`;
  reading `opts` directly compiled, ran, and silently yielded `EMPTY_OPTS`
  forever. This shipped: the semester's batch number stopped being sent and the
  section list came back from the wrong batch, with nothing on screen to show it.
  It is now impossible by construction: `runCascade(setup, fetchOptions)` in
  `cascade.ts` takes the selection and the known options **as arguments**, and
  returns the settled ones, so a run cannot see a stale render. Do not reintroduce
  a ref that shadows state; pass the value. `test/smoke.spec.ts` still watches the
  wire for the batch number.
- **The three tsconfigs are split on purpose.** `tsconfig.json` (web) pins
  `types` to React alone because `@types/node` is present transitively and would
  otherwise hand `web/` `process` and `Buffer`; `tsconfig.server.json` omits
  `dom` so `server/` cannot call `document`. Both were verified by probe, not
  assumed. Do not merge them into one config.
- **`lint.options.typeAware` and `typeCheck` are off, on purpose.** Vite+ enables
  both by default, and tsgolint then type-checks every file against **one**
  tsconfig. That cannot work here: the three-project split above is the whole
  point, and a single project either hands `web/` the server's globals or takes
  the server's away — `Bun` and `import.meta.dir` vanish from `server/server.ts`,
  and `toSorted` vanishes from the tests. It reported 213 errors on code `tsc`
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
- **Never `git push` without the user's explicit permission.** Commit freely when
  asked, but the push — which publishes and, now that Vercel builds from git,
  deploys — waits for a yes every time.
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
rather than cosmetic, so the rules are load-bearing. **The loop lives in
`web/cascade.ts`, the worklist in `web/worklist.ts`** — `runCascade` asks for
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
  cascade loop honest. The facts table above the register names it on screen so
  a wrong pick is visible rather than silent.
- **A newer refresh always wins, and the signal is what says so.** A change
  aborts the run before it — `cascadeRun` in `App.tsx` — and the run answers
  `null` rather than a settled selection, so an older pass cannot write to the
  screen. It used to be a `refreshToken` counter compared at the end; the abort
  is the same rule with the comparison replaced by the data structure. Both
  halves are load-bearing and both are tested: `runCascade` checks the signal
  before a pass *and* after the reply, so a run already superseded asks the
  Portal nothing and one superseded mid-flight asks no further.

## The data layer

**Every fetch goes through `web/client.ts`, and every read of server data is an
SWR key.** Nothing else in `web/` calls `fetch`. Six endpoints were hand-rolled
effects before this; they are now one wrapper (`getJson` / `postJson`, which turn
a non-2xx into an `ApiError`) and one hook per screen. See ADR 0020.

- **A key is a cache entry, so anything the user must ask for again on purpose
  gets a key that changes per ask.** The register is `[REGISTER_PATH, request,
  attempt]`, where `attempt` is a counter the click increments: every click is a
  load, a repeat click is not a cache hit, and "the click is the only way a
  register is ever fetched" survives the rewrite — `test/smoke.spec.ts` still
  counts the POSTs on the wire.
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
  for; a hook adds only what differs. Those defaults used to be repeated on every
  hook, five copies of one decision. The two exceptions are deliberate. The
  **session** probe overrides them: `refreshInterval` of `SESSION_PROBE_MS` when
  idle and `0` when a request is in flight or the login screen is up. And the
  **profile** hook keeps SWR's own "revalidate on mount if stale", which is why
  reopening a student's panel shows the last answer at once and refreshes it
  behind the panel — the panel's read is still one call per open, per ADR 0018,
  joined by one more only on the **All subjects** path, whose report states no
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
  swallow the probe. `test/client.spec.ts` enters that way on purpose.
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
`test/client.spec.ts` serves the built app and answers `/api/*` in the browser, so
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
version of `client.spec.ts`'s probe test was exactly that: it mounted the app on
`/login`, where the session hook is paused, and so could not see the focus
throttle it was written to pin.

**The register is in roster order; only the filtered table is sorted.** There are
two orders and they are both deliberate, so do not "fix" one into the other. Whole
class, the rows are the Portal's own `Sl.No` order — sorting it lowest-first made
the numbers read as a league table and stopped `Sl.No` running down the page.
With any filter ticked — *All irregular students*, *Below 75%*,
*Below 65%* — the table is a worklist rather than a roster, so it sorts
worst-first: that is the one thing the checkboxes are for. Ticked bars
intersect, so the strictest one wins. **The
figure read is the one the table shows**: the overall percentage on All subjects,
the Subject's own on a subject register — where the overall figure is not read as
a fallback, because that path puts no overall figure on screen, and a row admitted
or ordered by one would carry nothing to explain it. **A missing percentage sorts
last**, never first — `null`
is an absence of evidence, and putting such a student at the top of a triage list
sends someone after them for the wrong reason. `registerRows` in `web/worklist.ts`
owns all three rules, which is where they can be pinned without booting a server.

**A typed search is the one filter a new register clears.** A name or a roll was
typed for the class in front of the reader, so carrying it into the next load hides
every row of a register nobody searched — the failure looks like an empty class.
The ticked bars stay, because "show me who is below 75%" is a standing intent that
travels between classes. `loadRegister` in `App.tsx` clears the search and nothing
else, and `test/client.spec.ts` pins it.

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

Two traps in that probe, both hit the hard way. **Anything that drives the app
in a browser — the smoke test, and `client.spec.ts` — drives `dist/`, not the
source**, so a mutation to `web/` needs `bun run build` before it
will be observed — without the rebuild, four mutations "passed". And **a test that
signs in again after `page.goto` cannot see leaked state at all**, because a
reload discards it; inspect state in the same document, or the test passes
whatever the code does.

## Agent skills

### Code review
`/code-review` keeps its Spec axis, but its **Standards axis is
`$thermo-nuclear-code-quality-review` on the same diff**, not the skill's own
standards pass. Run one or the other, never both: two maintainability reads of
one diff produce two lists to reconcile, and the stricter one is the one that
finds the restructuring. The repo standards in `CODING_STANDARDS.md` still win
where the two disagree.

After every `$code-review`, run `$thermo-nuclear-code-quality-review`,
`$vercel-composition-patterns`, and `$vercel-react-best-practices` as MUST.
After all code review issues are fixed, then run `$ponytail-audit`.

### Issue tracker
Issues live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels
Five canonical roles, default strings. See `docs/agents/triage-labels.md`.

### Domain docs
Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

