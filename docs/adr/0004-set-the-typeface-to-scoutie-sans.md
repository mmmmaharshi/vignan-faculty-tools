# 0004 - Set the typeface to Scoutie Sans, and amend the stock-theme rule

Date: 2026-09-28

## Status

Accepted

Supersedes the "default Mantine theme is used untouched" line in `AGENTS.md`.
The "no custom CSS" rule is unchanged and still binding.

## Context

`AGENTS.md` said, in two sentences that had become load-bearing:

> There is no custom CSS in this project: no stylesheet, no CSS module, no inline
> `style` prop.
>
> The default Mantine theme is used untouched. `createTheme` is deliberately not
> imported.

The first is the one that matters. It is why the register table's row tint is
Mantine's `Table.Tr bg` pointed at `--mantine-color-*-light` rather than a class,
and why there is no stylesheet to keep in sync. It is a genuine architectural
constraint and it stays.

The second is narrower than it sounds, and it was a conclusion rather than a
requirement. It existed to enforce the first: with no custom CSS, the only way to
change the typeface would be the theme, so "no `createTheme`" was a way of saying
"the font is whatever Mantine picks." The reasoning was sound. The conclusion
overreached, because it also forbade the one change that is not CSS at all —
choosing a font is a project decision, not a styling mechanism.

`@fontsource-variable/scoutie-sans` is a font package. It contributes
`@font-face` rules naming one family, `Scoutie Sans Variable`, across three
unicode ranges. It is not a stylesheet of opinionated rules, and it adds no
selector that could override a Mantine component.

## Decision

Set the font family, and change the rule to match rather than the other way round.

`web/main.tsx` calls `createTheme` with exactly one key:

```ts
const theme = createTheme({
  fontFamily: '"Scoutie Sans Variable", sans-serif',
});
```

`AGENTS.md` now reads: the theme is stock *except* for `fontFamily`, that is the
only `createTheme` call in the project, and a second theme key is a signal to stop
and use a component prop instead.

## Why the rule moved rather than the code

Rejecting this would have meant either shipping a font package that is installed
and never imported, or setting the family through a CSS custom property on
`--mantine-font-family` — which is a hand-written CSS rule, so it violates the
rule that actually protects the architecture. Between those and one theme key, the
honest description is a font, and the rule was the thing that was wrong.

Keeping `main.tsx` as the only place a theme key is set matters more than the
number of keys. It means "what does this app's Mantine config look like" has a
one-line answer, so a future change is a diff in one file rather than a search.

## Consequences

- `main.tsx` now imports `createTheme`, so the old blanket ban is false and had
  to be amended. A rule that is enforced by grep rather than by understanding
  rots silently; this one would have.
- The font ships as three `.woff2` files — latin 26.6 kB, latin-ext 28.1 kB,
  vietnamese 9.0 kB — emitted by Vite as hashed assets. Only the ranges a
  character actually falls in are downloaded, per the `unicode-range` in the
  package's own CSS.
- `server.ts` already caches `/assets/*` immutably and `index.html` not at all,
  so the hashed font files are covered by the existing rule and needed no change.
- No test asserts the typeface. Font loading is not a property of the rendered
  page that a wrong implementation would break, and `CODING_STANDARDS.md` is
  against assertions that restate the implementation. It was verified by hand
  instead: `document.fonts.check('16px "Scoutie Sans Variable"')` returns true,
  and the computed `font-family` on the `<h1>` is the family above.
- The italic face is shipped by the package but not requested by the theme. Only
  the normal face is referenced. Say so before assuming italics render in Scoutie
  Sans — they will fall back to the next family in the stack.
