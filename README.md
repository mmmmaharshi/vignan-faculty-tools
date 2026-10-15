# Vignan Faculty Tools

A local web app for faculty. Sign in with your own ECAP credentials, pick a
course / semester / branch / section / subject and a date range, and get the class
roster with per-student attendance — sorted worst-first, so irregular students are
the first thing you see.

Built for the case that prompted it: knowing *who* is drifting in a class early
enough to do something about it, without manually exporting and eyeballing a
register each time.

## Run it

```sh
bun install        # once
bun run build      # builds the front end into dist/
bun server.ts      # then open http://127.0.0.1:8787
bun run typecheck  # tsc over all three projects
```

Sign in with your ECAP user name and password. The class dropdowns fill
themselves; pick a subject, set the date range, and press **Load register**.

For front-end work, run both halves with one command:

```sh
bunx vp run --parallel dev:all
```

That starts the API on :8787 and Vite on :5173 together, so one Ctrl-C stops
both. Open **http://localhost:5173** — the dev server proxies `/api` to :8787.
Use `localhost`, not `127.0.0.1`: the dev server binds the IPv6 loopback only.
`bun run dev` on its own starts Vite without the API, which is only useful if
the server is already running. Production is the single-process path above.

## Tests

```sh
bunx playwright install chromium                          # once
ECAP_USER=... ECAP_PASS=... bun run test
```

**Almost every test needs no credentials and no network, and the whole suite runs
in seconds.** They cover the portal's parsing, its wire conventions, the
attendance bands, the two route handlers (over a fake portal), and the cascade's
rules. **Read the count off the run** — no number is kept here, because it goes
stale the moment a test is added.

The rest are end-to-end smoke tests that sign in to the live portal and load a
real register. They skip without credentials rather than passing vacuously, which
is why everything reachable without a portal is tested above. A DOM stub is not
sufficient for them — a stub was tried against the previous build and it passed
code that was broken in a real browser.

Every test in the fast suite was proven to fail by breaking the rule it
describes, so a green run means something.

## What it shows

| Stat | Meaning |
|---|---|
| Students | Class size |
| Class average | Mean attendance across the class |
| Below 75% | Students needing a check-in |
| Below 65% | Students who need intervention now |

The table is listed in the **Portal's own roster order**, not sorted by
attendance, so the numbers read as a roster rather than as a ranking. Only
**critical** rows are tinted — an irregular student is badged `low` beside their
own percentage instead, because a class with a third of its roster irregular is a
class with a third of its rows coloured, and then the colour stops meaning
anything. Tick *Show only irregular students* to reduce the table to just the
students you care about; that filtered table is a worklist rather than a roster,
so it is sorted **lowest attendance first** — the student who most needs a
check-in is the first one reached.

The line above the table always names the register that is on screen. With five
dropdowns in front of you it is easy to read last week's numbers as this week's.

## How your password is handled

- It is posted to `127.0.0.1` — the server binds to loopback only, nothing leaves
  your machine except the sign-in request to ECAP over HTTPS.
- **It is kept in the Windows Credential Manager** (via `Bun.secrets`) on a
  runtime that has it, so the app can sign you back in when ECAP's own session
  times out. It narrows what sits on disk; it is not a boundary against another
  process running as you. It is never logged and never returned by any endpoint.
  This is a change from earlier versions, which discarded it; ADR 0019 records why
  and what it costs.
- **Where there is no vault, it is written in plaintext.** The dev server runs the
  API in Node, which has no `Bun.secrets`, so the store falls back to a
  `.dev-sessions.json` file beside the source: gitignored, plaintext, and never for
  production — and in this checkout that file sits inside a OneDrive-synced
  directory.
- Signing in opens a session that lasts **up to 30 days without use** on our side.
  Both halves slide: the server stamps the session on every request, and the
  browser cookie is re-issued on every response, so the window is 30 days from your
  *last* use rather than from signing in.
- **Restarting the server does not sign you out.** On a runtime with an OS vault
  the sign-in token lives in the **Windows Credential Manager**, so nothing gets
  synced to cloud storage by accident; the dev fallback above is the exception.
- **ECAP's own session is much shorter, and it used to be the real limit.**
  Both of the portal's cookies are session cookies with no expiry, and the
  credential is bound to ECAP's in-memory ASP.NET session: measured against the
  live portal, **idle for 15 minutes it still works; idle for 45 it does not.** So
  the 30 days is a ceiling nothing will reach. **When ECAP has forgotten you, the
  app signs in again with the stored credential and re-runs the request** — one
  retry, no interception. You are only asked to sign in by hand if the password
  itself no longer works, or if this runtime has no credential vault. See ADR
  0014 for the portal's limit and ADR 0019 for the re-sign-in.

## The front end

React 19 and Mantine 9, built by Vite 8 through Vite+ (`vp build`, `vp dev`,
`vp check`). **There is no custom CSS** — no
stylesheet, no CSS module, no inline `style` prop. Every visual decision is a
Mantine component or a Mantine colour token, read through Mantine's own `bg` and
`c` props.

The Mantine default theme is used untouched. Dark mode is available for free by
adding a `MantineProvider` colour scheme and a toggle; it is not wired up, because
the port was scoped to a port.

Print was **removed** as part of the port. Mantine ships no print stylesheet, and
"no custom style" was taken literally, so a printed register would come out as
whatever the browser does with `Paper` and `Badge`. See
[ADR 0001](docs/adr/0001-port-ui-to-react-and-mantine.md). Restoring it is a
small `@media print` block, not a rewrite.

## How it talks to ECAP

The portal is an ASP.NET WebForms site, and its Academic Register page is a
**client-side shell**: the server renders no dropdowns at all, and the page's own
JavaScript builds them by calling remote methods. Everything this app needs is
therefore a direct HTTPS request — about 3 seconds from a cold sign-in to a
rendered 63-student register.

There are two different remote-call conventions on that site, and using the wrong
one returns an empty result with no error. Both are handled in `server.ts`.

**A — dropdown fillers**, `POST /vignanit/jqmethods.aspx/<Method>`

```js
Content-Type: application/json; charset=utf-8
body:  {'courseid':1,'branchcontrolid':'ddlbranch',...}   // single-quoted
reply: JSON, markup in .d  (an array when several divs fill at once)
```

`LoadCourses`, `LoadBranchAndSemestersDropDown`, `LoadBranchSections`

**B — static web methods**, `POST {proxy}?_method=<Name>&_session=no`

```js
body:  CourseId=1\r\nBranchId=6\r\nSemesterId=2     // names, not positions
reply: a JavaScript literal, not JSON: a bare quoted HTML string
```

`FillSubjects`, `ShowAcademicCalendar`

Three details that are not obvious, and cost real time to find:

1. **The password is not posted as typed.** The login field carries
   `onkeyup="encryptJSText(1)"`, which runs AES-128-CBC with a key hardcoded in
   the page source into a hidden field; `onblur="setValue(1)"` then copies that
   ciphertext back over the visible field. So the POST carries the **ciphertext**
   in both `txtPwd1` and `hdnpwd1`. The output is the bare ciphertext, base64'd —
   *not* the OpenSSL `Salted__` form that stock CryptoJS produces. This portal's
   `JSFiles/jsaes.js` is a custom build, and getting this wrong means the server
   cannot parse the blob at all.

   That key is a client-side constant, so it protects nothing on the wire. HTTPS
   is what actually protects the password.

2. **The login form posts to `Default.aspx`, not to itself**, and needs
   `__VIEWSTATE` / `__EVENTVALIDATION` from a prior GET. The submit control is an
   `<input type="image">`, so the body must carry `imgBtn1.x` and `imgBtn1.y` or
   ASP.NET never raises the Click event and login silently does nothing.

3. **`ShowAcademicCalendar` wants every level twice** — the option's `value` *and*
   its visible label (`Course`/`CourseName`, `Branch`/`BranchName`,
   `Semester`/`SemesterName`) plus the subject's `title` attribute. Passing only
   values returns nothing. The front end sends each level whole — the `Option` it
   already holds from `/api/options` — so the server needs no cache of its own.

The portal's `enc()` escapes only `%` and `=`, so values are deliberately **not**
url-encoded.

## Project layout

```
server.ts             Bun HTTP server: routing, sessions, static files, SPA fallback, transport
server-routes.ts      the two route handlers, over a PortalReader; no HTTP in it
portal-conventions.ts the portal's wire conventions: bodies, cipher, cookie jar
portal-replies.ts     pure string -> data functions, and the seam guards
attendance-bands.ts   the Regular / Irregular / Critical rule, and the summary
web/index.html        Vite entry point
web/main.tsx          React root + MantineProvider
web/App.tsx           state, the routes, and the refresh loop
web/cascade.ts        the cascade's rules: what auto-fills, when to keep looping
web/components/       five presentational modules; none of them holds state
shared/api.ts         the server/client contract; both sides import it
vite.config.ts        build, lint and format config (Vite+; Ultracite presets)
playwright.config.ts  test runner config
test/*.spec.ts        128 fast tests, no credentials; plus eleven live smoke tests
tsconfig*.json        three projects, split so web/ has DOM and server.ts does not
dist/                 build output, served by server.ts
```

One rule explains that layout: **importing `server.ts` boots a server**, so
anything with a decision in it lives in a file that can be imported without one.
`docs/adr/` records each of those extractions and why.

## Notes and limits

- Read-only. It signs in and reads the academic register; it never submits marks
  or changes enrollment.
- Section and subject lists come from ECAP, so the app only offers classes you
  actually teach. Every branch and semester the portal offers has been checked,
  and no level has ever come back empty — sections run from one to four and
  subjects from fifteen to fifty-one. If one ever does, the app says which level
  and carries on rather than either failing or leaving you with a dead dropdown.
  (IV Semester having exactly one section is a statement about count, not about
  emptiness — it was once mistaken for the latter here.)
- The cascade populates itself: every level above the subject fills with its
  first option and you override whatever you disagree with. The subject is always
  left for you, because it decides which register loads, and the line above the
  table names the register on screen.
- One cookie jar per signed-in user, so two people can be signed in at once.
- The thresholds are 75% and 60%, set once in `attendance-bands.ts` and sent to
  the client in the summary, so the stat cards and the row flags cannot disagree.
  A percentage the portal would not give is in no band at all and is left out of
  the class average — a parsing failure is not evidence of bad attendance.
- 128 fast tests with no credentials, and eleven end-to-end smoke tests against
  the live portal. Every fast test was proven to fail by breaking the rule it
  describes.
- **The selection is not in the URL.** The address bar names the screen and
  nothing else. A register cannot be sent as a link, and a refresh re-picks the
  cascade from the top. `Load register` is the only thing that fetches one. See
  ADR 0015 for what this replaced and what it cost.
- If the portal changes its markup, the `Portal` methods in `server.ts` will need
  revisiting: the endpoint paths and the parameter names. Watch the labels
  especially — when the text `ShowAcademicCalendar` expects stops matching, the
  register comes back empty rather than erroring, and the 502 says so: either the
  date range is wrong or the layout has changed.

