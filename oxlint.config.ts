/**
 * Lint rules, straight from the Ultracite presets.
 *
 * 568 rules on, 92 off, across 11 plugins. `ultracite init` is how this is meant
 * to be installed and it is broken in 7.12.1 - it exits 1 partway through with
 * `TypeError: Xt[e] is not iterable`, after reordering package.json and adding a
 * redundant `strictNullChecks` to all three tsconfigs, and before writing any
 * config. Prefer re-running it over this file if a later version works.
 *
 * The point of a linter is to catch real problems, not to reformat code until it
 * matches someone else's taste. Each rule below is off because it contradicts a
 * standard in CODING_STANDARDS.md, contradicts a decision recorded in an ADR, or
 * because the tool is wrong. They were measured against the 262 errors the preset
 * reported on first run; roughly half of what it complained about is fixed rather
 * than suppressed.
 */

import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

/**
 * Files with no browser in them.
 *
 * The core preset sets `env.browser` project-wide, which reads as though
 * `server.ts` may reach for `document`. The split tsconfigs are what actually
 * stop it, and that is verified - `tsc` rejects `document` in the server project.
 * This override is here so the linter's config does not contradict them, not
 * because it enforces anything: `no-undef` is not a rule this preset enables, and
 * oxlint skips it for TypeScript regardless, so the claim could not be
 * demonstrated. It is documentation that costs nothing.
 */
const SERVER_SIDE = ["server.ts", "portal-replies.ts", "shared/**"];

/** Rule name -> why it is off. The reason is the point; the value is not read. */
const OFF = {
  // CODING_STANDARDS.md prefers one-liners where they are equally clear, and all
  // 35 sites are deliberate single-line guards like `if (!roll) continue;`.
  curly: "",

  // Key order here is semantic. The cascade reads course -> semester -> branch ->
  // section -> subject, and the register row reads sl, roll, name, then the two
  // attendance columns. Alphabetising either would obscure that.
  "sort-keys": "",

  // Every one of these is a nullish check, not a mistake. `pct` is
  // `number | null` and `!= null` is what catches a missing field as well as a
  // null one; `=== null` would quietly pass undefined through. eqeqeq is
  // narrowed below rather than disabled, so a real `==` still fails.
  "no-eq-null": "",

  // Not a rule - an oxlint-react crash. It reports a `todo` diagnostic whose text
  // is an internal compiler error, on any try/finally. There is no TODO here.
  "react/todo": "",

  // 33 sites, all on the HTML-parsing regexes, which are verified against the
  // live portal. The `u` flag is not purely additive - it changes what `.`
  // matches - and rewriting working parsing for a style rule is the wrong trade.
  "require-unicode-regexp": "",

  // ADR 0001 recorded the cascade as a deliberate line-for-line port and
  // explicitly rejected rewriting it as a reducer. These three all want that
  // rewrite in miniature: splitting the function, splitting the loop, hoisting
  // the await.
  complexity: "",
  "no-await-in-loop": "",
  "no-loop-func": "",

  // The codebase uses function declarations throughout. Converting 25 of them to
  // assigned arrows is churn, not improvement.
  "func-style": "",

  // Trailing comments carry the reasoning this project depends on - why a value
  // is read before the updater, why a level is unguarded, why an assertion is
  // sound. A rule that deletes them deletes the explanation.
  "no-inline-comments": "",

  // `i++` is used consistently across the loops that need a counter.
  "no-plusplus": "",

  // `shared/api.ts` uses `interface` deliberately: it is a contract meant to be
  // extended, and `interface` is what allows declaration merging.
  "typescript/consistent-type-definitions": "",

  // Rewrote `options(undefined)` to `options()`, which is not even a valid call -
  // `options` takes a required parameter. The explicit undefined was the case
  // under test: the portal sending nothing usable.
  "unicorn/no-useless-undefined": "",

  // Rewrote `innerText()` to `textContent()` throughout the smoke test's DOM
  // scraping. `textContent` is `string | null` where `innerText` is `string`, so
  // the rewrite does not compile - caught by tsc, not by oxlint. It is also a
  // different question: innerText is the rendered text, textContent is the raw.
  "unicorn/prefer-dom-node-text-content": "",

  // Wants `app.tsx`. React's own convention is PascalCase for a component file,
  // and the import in main.tsx is written to match. Renaming to satisfy a
  // filename rule would be the tail wagging the dog.
  "unicorn/filename-case": "",
};

const rules: Record<string, unknown> = { ...core.rules, ...react.rules };
for (const rule of Object.keys(OFF)) {
  if (rule in rules) rules[rule] = "off";
}
rules.eqeqeq = ["error", "always", { null: "ignore" }];

export default defineConfig({
  env: core.env,
  plugins: [...(core.plugins ?? []), ...(react.plugins ?? [])],
  ignorePatterns: core.ignorePatterns,
  rules,
  overrides: [
    ...Object.entries(core.overrides ?? {}).map(([files, value]) => ({ files, ...value })),
    { files: SERVER_SIDE, env: { browser: false, node: true } },
  ],
});
