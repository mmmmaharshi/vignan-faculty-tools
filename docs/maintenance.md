# Maintenance traps

Every rule below is load-bearing. Read the branch you are about to change;
the pointers in AGENTS.md name when to do so.


- **The portal is a client-side shell.** Its Academic Register page renders no
  dropdowns at all; the page's own JavaScript builds them by calling remote
  methods. There are two different calling conventions and using the wrong one
  returns an empty result with no error. `server/portal-conventions.ts` and
  `server/portal-transport.ts` implement them; `docs/portal-wire.md` states each
  method's contract.
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
- **The Portal's per-method contracts live in `docs/portal-wire.md`.** Reach for
  it before writing any ECAP call: proxy, method, `_session` marker, parameter
  names in declared order, reply shape, and the traps measured against each.
  `bun scripts/portal-probe.ts [method]` prints the signed-in proxy's own
  declarations, which is the only place a contract exists — so a name is
  measured, never guessed. Two conventions exist: **generated-proxy**
  (`?._method=` + a `key=value` body) and **jQuery** (`jqmethods.aspx/<Method>`),
  and reaching a proxy-only method through jQuery answers a generic 500 while
  other methods on that endpoint still work.
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

- **The month table is one class report per month, and the figure is ECAP's own.**
  A monthly counselling report quotes the term so far, so each row is a window
  from the semester start to that month's end, read through `ShowAllAttendance`
  and stated as ECAP stated it — never a percentage divided out of ADR 0026's
  counts, because ECAP states no percentage there and the arithmetic would
  disagree with the Portal the moment the windows differ by a period. The rows go
  out in parallel, from the semester start's month through the current one, capped
  at the same twelve months the walks use — a start older than the cap drops its
  oldest rows rather than stopping short of the month in progress; a month ECAP
  refuses with a 502 leaves that row a dash while the rest of the table stands,
  and a 401 from any month still signs out. No open register or no known start
  means no table, and a roll is matched the one way `sameRoll` matches it, so a
  casing difference cannot blank the whole table. Each month's report is bounded
  by the Portal's 12-second call timeout, so a slow one is a blank row rather
  than a panel that never answers; the rows go out together, not one budget each.
  The Student Search screen reads
  the same table through `handleFind`, which knows its section and start by then,
  so the two panels never disagree. ADR 0029 records the cost: this is the
  heaviest read in the app.

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

- **The From input opens at the walked semester start, not the month.** When
  the cascade settles on a class with no remembered start, the app asks
  `/api/sem-start` with `walkBack` before any register loads: the asked month
  plus up to six before it, each a month-shaped read — the only shape ECAP
  reliably answers — stopping at the first dateless month, and From opens at
  the earliest day found. A class the memory already names probes nothing; a
  range typed by hand wins over a probe that lands after it; a probe that
  fails changes nothing, except a 401, which still signs out. `Load register`
  stays the only caller of `/api/register`: the walk reads through
  `/api/sem-start`, the same endpoint the row above already calls. While the
  walk is in flight for a class with no remembered start, Load register stays
  disabled under a "Finding the semester start…" note — while the inputs stay
  live — so the first click cannot take the month window still on screen.
  Till Now is the standing window, not just the opening one. Typing From
  lifts the gate at once: it needs no probe, while a typed To alone leaves
  From unsettled. A failed walk lifts it too; the month window is the
  fallback then.

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

- **A saved section is four values, and no Portal call.** `Save this section`
  writes course, semester, branch and section; a card above the class form fills
  those four and lands on the section-wide register (`ALL SUBJECTS`), so the user
  narrows from there. One card per section, never one per subject: a subject says
  which register to read, not which section the user works in. There is no
  dashboard and no per-subject fetch — one was built and removed, and ADR 0016
  records why. **A Section has no statistics of its own**, which is why the
  summary cannot be a section row. ADR 0030 records the move back from one card
  per subject. See
  `docs/adr/0016-the-saved-class-opens-the-register-it-names.md`.

- **A stored card is five values even though four name it.** The subject key
  stays in the stored shape, always `ALL SUBJECTS`, so a card written when a card
  named a subject still reads as the section it belongs to and the five-value key
  stays one shape. The subject is never read back: a card opens a section, so
  whatever subject was on screen at save time is not part of what it means.

- **`resetFor` is why opening a card keeps its subject.** A section change
  invalidates everything below it, so opening a card with "the section changed"
  would clear the subject the card arrives with. A change that **arrives carrying
  a selection** clears nothing below it; one made by hand still clears the
  subject. It lives in `cascade.ts` rather than the component because a rule that
  cannot be imported without booting a server cannot be tested, and this one
  shipped wrong twice before it was.

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
  `read()` in `web/data/client.ts` saves the session only when an answer carries
  one; `signedOut` in `App.tsx` clears storage beside the cache sweep. There is
  no server-side eviction because there is nothing server-side to evict — a 401
  from signing in is about the password just typed, and any other 401 is about
  the session the request carried. An answer only slides the session its own
  request set out with: clearing bumps an epoch, so a response already in
  flight across a sign-out lands on a stale epoch and is dropped instead of
  logging the next visit back in. Reads are keyed under the same generation,
  so a late body cannot reach a hook either. The generation is per-tab
  memory: a second open tab can still re-save after this tab signs out —
  that half is out of scope, not a second bug.
- **The ECAP password lives in localStorage in the clear.** Deliberate,
  user-accepted: it is what lets the server keep nothing and still revive a
  dead portal session without asking again. Anyone holding the browser's
  storage holds the ECAP account with it. Do not log it, print it, or widen
  where it travels — it already goes on every request, which is exactly enough.
- **No register rows are kept in the browser.** The dashboard view lives only in
  memory for the current load; a reload or a new visit opens on the form with no
  table. The session and its credential are still in localStorage by ADR 0024,
  and the timetable's own periods and the semester starts are remembered as Portal
  facts, but no student rows are written to storage (ADR 0032).
- **There is deliberately no login rate limiter.** A limiter that works needs a
  shared store once more than one instance serves traffic, and an in-memory one
  on a serverless function silently becomes per-instance — false confidence. The
  attempts proxy straight to ECAP, whose own lockout policy is the real gate.
  Do not add one without a store both runtimes share.
- **One module probes, one module decides: `portal-liveness.ts` and
  `session-verdict.ts`.** The probe answers `alive | dead | unknown` from ECAP's
  course list; `sessionVerdict` combines that with the one revival's failure into
  the answer `/api/session` gives. `handleOptions` calls `requireCourses` for the
  probe directly; the liveness guard makes an all-held options request prove the
  session before it answers. The two rules were once written in one layer, and
  the copy without test coverage was the one that shipped the bug.
- **`unknown` is not `dead`, and a 502 must never sign anyone out.** A signed-out
  request to convention A answers **HTTP 200 with valid JSON** whose `<select>`
  holds only `-Select-` — every sign of life looks good, which is why the check is
  not "did it throw" — and every account has at least one course, so an empty list
  can only mean the session is gone. But a 502 is genuinely ambiguous, and ADR 0002
  and ADR 0013 both refused to treat it as an expiry.
- **A caller needing both the verdict and the options must use `requireCourses`.**
  Reading `portal.courses()` first and passing the result to `courseVerdict` lets a
  throw escape *before* the rule is reached, so the 502 refusal holds by accident
  rather than by decision — the first version did exactly that, and a mutation
  probe caught it. Both handlers that start from the course list therefore call
  `requireCourses`, which throws the 401 or the 502 and returns the list otherwise.
  There is no client-side net behind it: an empty course list never reaches the
  browser, so nothing on the front end can fire for it.
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
  to it (or to any `server/` module behind it) restarts the Vite dev
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
  whatever was on disk. See ADR 0002 and 0012. The one exception: a
  visual-only diff — no logic, no types, no data flow, only presentation —
  verifies with lint, typecheck, a fresh build, and the directly affected
  spec file (`--config=playwright.fast.config.ts`), instead of the full
  suite. A one-prop alignment change cannot break a seam it does not touch.
- **Nothing in the cascade reads state from a closure any more, and that is the
  fix.** `runRefresh` used to be memoised with `[]`, so it closed over render 1
  and anything reading `sel` or `opts` had to go through `selRef` / `optsRef`;
  reading `opts` directly compiled, ran, and silently yielded `EMPTY_OPTS`
  forever. This shipped: the semester's batch number stopped being sent and the
  section list came back from the wrong batch, with nothing on screen to show it.
  It is now impossible by construction: `runCascade(setup, fetchOptions)` in
  `cascade-run.ts` takes the selection and the known options **as arguments**, and
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
  is in the `lint` and `fmt` blocks of `vite.config.ts`. The lint block spreads
  `@cloudflare/oxlint-config` with no rules turned off; the preset and Vite+
  declare two copies of oxlint's config types, so the preset is asserted once to
  Vite+'s `lint` type before it is spread. Keeping that assertion is cheaper than
  forcing both toolchains onto one oxlint version.
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
- **The commit hook lints, formats, then type-checks.** `staged` maps `**/*` to
  two commands: `vp check --fix` (format and lint, staged files only) and
  `bun scripts/typecheck-staged.ts`, which runs the project's own `typecheck`.
  A type error therefore stops the commit rather than reaching history — the
  gap this closed was that `vp check` never read types and the suite was the
  only other `tsc`. The array form of `staged` runs each entry as its own
  command, so the wrapper exists to swallow the filenames lint-staged appends
  (`tsc` rejects them: "Option 'project' cannot be mixed"); it never narrows the
  check to the staged files, because a type error in one file is usually a
  contract change in another.
- **`"**/*"` in the `staged` block, not `"*"` and not a file-type list.** The
  unanchored `*` happens to reach subdirectories today, but only because
  lint-staged matches on basename; `**/*` says what is meant. It also leaves the
  unstaged files alone — verified by staging one badly formatted file next to
  another, and only the staged one came back rewritten.

