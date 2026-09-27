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
bun server.js              # http://127.0.0.1:8787
bun run dev                # Vite on :5173, proxies /api to :8787 (run both)
```

## Layout

```
server.js           Bun HTTP server; all ECAP interaction lives here
web/index.html      Vite entry point
web/main.jsx        React root + MantineProvider
web/App.jsx         cascade, table, CSV export
vite.config.js      build config
dist/               build output, served by server.js (not source)
```

## The front end is Mantine-only

There is no custom CSS in this project: no stylesheet, no CSS module, no inline
`style` prop. Visual decisions are Mantine components, or Mantine colour tokens
read through Mantine's own `bg` and `c` props. If you find yourself wanting a
custom rule, the answer is usually a component prop that already exists — check
`Table.Tr bg`, `Table striped`, `Badge color` before reaching for CSS.

The default Mantine theme is used untouched. `createTheme` is deliberately not
imported.

## Things that will bite you

- **The portal is a client-side shell.** Its Academic Register page renders no
  dropdowns at all; the page's own JavaScript builds them by calling remote
  methods. There are two different calling conventions and using the wrong one
  returns an empty result with no error. `server.js` documents both.
- **The password is AES-encrypted client-side before it is posted**, and the
  output is bare ciphertext, base64'd — not the OpenSSL `Salted__` form that
  stock CryptoJS produces. This portal's `JSFiles/jsaes.js` is a custom build.
- **`ShowAcademicCalendar` needs every level twice**, value *and* visible label.
  Passing only values returns nothing rather than failing. Labels are cached per
  session for exactly this reason, and that cache is the most fragile part of
  the integration.
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
- **Vite hashes asset filenames.** `server.js` caches `/assets/*` immutably and
  `index.html` not at all; changing that pair reintroduces "my fix did nothing".

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
- **Auto-choose only when there is exactly one option.** With several, stop and
  let the user pick — silently choosing one of three sections risks showing the
  wrong class. The subject is never auto-chosen, for the same reason.
- **A newer refresh always wins.** `refreshToken` makes an older in-flight
  request bail rather than write to the DOM.

## Testing

There is no automated test suite. A DOM stub is not sufficient here: one was tried
against the previous vanilla build and it passed code that was broken in a real
browser, because it did not model `selectedIndex`/`value` coupling or `innerHTML`
clearing a select's options. If tests get added, drive a real browser.

## Agent skills

### Issue tracker
Issues live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels
Five canonical roles, default strings. See `docs/agents/triage-labels.md`.

### Domain docs
Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
