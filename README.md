# ECAP Attendance Dashboard

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
bun server.js      # then open http://127.0.0.1:8787
```

Sign in with your ECAP user name and password. The class dropdowns fill
themselves; pick a subject, set the date range, and press **Load register**.

For front-end work, `bun run dev` runs Vite on :5173 and proxies `/api` to the
server on :8787, so run both. Production is the single-process path above.

## Tests

```sh
bunx playwright install chromium                          # once
ECAP_USER=... ECAP_PASS=... bun run test
```

One end-to-end smoke test that signs in to the live portal and loads a real
register. It skips without credentials rather than passing vacuously. A DOM stub
is not sufficient for this app — one was tried against the previous build and it
passed code that was broken in a real browser.

## What it shows

| Stat | Meaning |
|---|---|
| Students | Class size |
| Class average | Mean attendance across the class |
| Below 75% | Students needing a check-in |
| Below 60% | Students who need intervention now |

The table is sorted **lowest attendance first**, with irregular rows tinted and
the critical one badged. Tick *Show only irregular students* to reduce it to just
the students you care about. **Save CSV** exports roll, name, attended/held,
percent, and a Regular / Irregular / Critical flag.

The line above the table always names the register that is on screen. With five
dropdowns in front of you it is easy to read last week's numbers as this week's.

## How your password is handled

- It is posted to `127.0.0.1` — the server binds to loopback only, nothing leaves
  your machine except the sign-in request to ECAP over HTTPS.
- It is used once, to encrypt the login payload. It is never written to disk,
  never logged, and never returned by any endpoint.
- Sign-in keeps a session alive for up to 12 hours. When that expires you sign in
  again. There is no stored password to leak or reuse.

## The front end

React 19 and Mantine 9, built by Vite 8. **There is no custom CSS** — no
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
one returns an empty result with no error. Both are handled in `server.js`.

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
   values returns nothing. Labels are cached per session as the dropdowns fill,
   because the browser only ever sends values.

The portal's `enc()` escapes only `%` and `=`, so values are deliberately **not**
url-encoded.

## Project layout

```
server.js           Bun HTTP server; all ECAP interaction lives here
web/index.html      Vite entry point
web/main.jsx        React root + MantineProvider
web/App.jsx         cascade, table, CSV export
vite.config.js      build config
dist/               build output, served by server.js
```

## Notes and limits

- Read-only. It signs in and reads the academic register; it never submits marks
  or changes enrollment.
- Section and subject lists come from ECAP, so the app only offers classes you
  actually teach. Some combinations are genuinely empty — IV Semester has one
  section for most branches, for instance.
- The cascade populates itself as far as the subject list, auto-selecting a level
  only when the server offers a single option. The subject is always left for
  you, because pre-selecting one risks loading the wrong register.
- One cookie jar per signed-in user, so two people can be signed in at once.
- **No test suite.** A DOM stub is not sufficient here: one was tried against the
  previous vanilla build and it passed code that was broken in a real browser,
  because it did not model `selectedIndex`/`value` coupling or `innerHTML`
  clearing a select's options. If tests get added, drive a real browser.
- If the portal changes its markup, the `Portal` methods in `server.js` will need
  revisiting: the endpoint paths, the parameter names, and the label cache that
  feeds `ShowAcademicCalendar`. That last one is the most fragile, because the
  register comes back empty rather than erroring when the labels stop matching.
