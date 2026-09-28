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
server.ts           Bun HTTP server; routes, sessions, the Portal HTTP client
portal-replies.ts   pure string -> data functions, and the seam guards
web/index.html      Vite entry point
web/main.tsx        React root + MantineProvider
web/App.tsx         cascade, table, CSV export
shared/api.ts       the server/client contract; both sides import it
vite.config.ts      build config
playwright.config.ts  test runner config
test/seam.spec.ts   pure-function tests over fixture markup; no portal needed
test/smoke.spec.ts  one end-to-end pass against the live portal
tsconfig*.json      three projects, split so web/ has DOM and server.ts does not
dist/               build output, served by server.ts (not source)
```

`portal-replies.ts` is separate from `server.ts` for one reason: importing
`server.ts` boots a server, so nothing in it can be unit-tested. Everything in
`portal-replies.ts` is a pure function over a string, which is what lets
`test/seam.spec.ts` run in milliseconds with no portal and no credentials. Keep
it that way — a network call in there makes the whole fast suite unreachable.

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
- **Nothing typechecks the project.** Vite and Playwright both use esbuild, which
  strips types without reading them, so `bun run build` passing says nothing about
  types and `bun run test` will not catch a type error. `bun run typecheck` is the
  only thing that does, and it does not run itself. See ADR 0002.
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

## Testing

```sh
bunx playwright install chromium      # once
ECAP_USER=... ECAP_PASS=... bun run test
```

One end-to-end smoke test in `test/smoke.spec.ts`. It signs in to the live portal
and loads a real register, because a DOM stub is not sufficient here: one was
tried against the previous vanilla build and it passed code that was broken in a
real browser, since it did not model `selectedIndex`/`value` coupling or
`innerHTML` clearing a select's options.

It skips when `ECAP_USER` / `ECAP_PASS` are unset. A green run that checked
nothing would be worse than no run, so it refuses to pass vacuously.

Per `CODING_STANDARDS.md`, the assertions are properties of the rendered page, not
restatements of the code: percentages ascend, the first row is the minimum, the
flagged-row count equals the stat card, and the register on screen is named.
Each breaks for its own distinct reason. Do not add assertions that mirror the
implementation — they pass when the code is wrong and prove nothing.

## Agent skills

### Issue tracker
Issues live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels
Five canonical roles, default strings. See `docs/agents/triage-labels.md`.

### Domain docs
Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
