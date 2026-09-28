/**
 * Regenerate `.oxlintrc.json` and `.oxfmtrc.json` from the Ultracite presets.
 *
 * Why this exists instead of the configs importing the presets directly:
 *
 *  - oxlint's JavaScript and TypeScript config files are experimental and only
 *    work when oxlint runs under Node. This project runs Bun. A `.json` config
 *    works everywhere, so the preset is resolved here, once, and written out.
 *  - oxfmt *can* read `.mjs`, but only when pointed at it with `-c`. Its
 *    auto-discovery looks for `.oxfmtrc.json`, and `ultracite fix` invokes oxfmt
 *    without one - so an `.mjs` config is silently ignored and the run formats on
 *    oxfmt's defaults instead. That is not hypothetical: the first pass
 *    reformatted the whole repository to defaults.
 *
 * The cost is that the committed JSON can drift from the installed preset, so
 * re-run `bun run lint:config` after upgrading Ultracite. `ultracite doctor`
 * will not catch that on its own.
 */

import { writeFile } from "node:fs/promises";

import oxfmt from "ultracite/oxfmt";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

/**
 * Files with no browser in them.
 *
 * The Ultracite core preset sets `env.browser` for the whole project, which reads
 * as though `server.ts` may reach for `document`. The split tsconfigs are what
 * actually stop it, and that is verified - `tsc` rejects `document` in the server
 * project. This override is here so the linter's own config does not contradict
 * the tsconfigs, not because it enforces anything: `no-undef` is not a rule this
 * preset enables, and oxlint skips it for TypeScript regardless, so the claim
 * could not be demonstrated. It is documentation that costs nothing.
 */
const SERVER_SIDE = ["server.ts", "portal-replies.ts", "shared/**"];

/**
 * Rules switched off, and why.
 *
 * The point of a linter is to catch real problems, not to reformat code until it
 * matches someone else's taste. Each of these was measured against the 262 errors
 * the preset reported on first run, and each falls into one of three groups:
 * it contradicts a documented standard in this repo, it contradicts a decision
 * recorded in an ADR, or the tool is wrong. Everything not listed here stays on,
 * and roughly half of what the preset complained about is fixed rather than
 * suppressed.
 */
const OFF: Record<string, string> = {
  // CODING_STANDARDS.md:3 prefers one-liners where they are equally clear, and
  // all 35 sites are deliberate single-line guards like `if (!roll) continue;`.
  curly: "CODING_STANDARDS.md prefers one-liners where equally clear",

  // Key order here is semantic. The cascade reads course -> semester -> branch
  // -> section -> subject, and the register row reads sl, roll, name, then the
  // two attendance columns. Alphabetising either would obscure that.
  "sort-keys": "key order is semantic in the cascade and register row",

  // Every one of these is a nullish check, not a mistake. `pct` is `number |
  // null` and `!= null` is what catches a missing field as well as a null one;
  // `=== null` would quietly pass undefined through. eqeqeq below is narrowed
  // rather than disabled so real `==` still fails.
  "no-eq-null":
    "every site is a deliberate nullish check; `=== null` misses undefined",

  // Not a rule - an oxlint-react crash. It reports a `todo` diagnostic whose
  // text is an internal compiler error, on any try/finally. There is no TODO in
  // this repository.
  "react/todo":
    "oxlint-react crashes on try/finally and reports it as a todo diagnostic",

  // 33 sites, all on the HTML-parsing regexes, which are verified against the
  // live portal. The `u` flag is not purely additive - it changes what `.`
  // matches - and rewriting working parsing to satisfy a style rule is the wrong
  // trade. Revisit if the portal's markup is ever re-verified anyway.
  "require-unicode-regexp":
    "HTML-parsing regexes are verified against the live portal; `u` changes matching",

  // ADR 0001 recorded the cascade as a deliberate line-for-line port and
  // explicitly rejected rewriting it as a reducer. These three all want that
  // rewrite, in miniature: splitting the function, splitting the loop, hoisting
  // the await.
  complexity:
    "ADR 0001: the cascade is a deliberate port; splitting it is the rejected rewrite",
  "no-await-in-loop":
    "ADR 0001: each cascade pass depends on the one before it",
  "no-loop-func":
    "ADR 0001: the loop body closes over the running draft deliberately",

  // The codebase uses function declarations throughout. Converting 25 of them to
  // assigned arrows is churn, not improvement.
  "func-style":
    "this codebase uses function declarations; arrows are not an improvement here",

  // Trailing comments carry the reasoning this project depends on - why a value
  // is read before the updater, why a level is left unguarded, why an assertion
  // is sound. A rule that deletes them deletes the explanation.
  "no-inline-comments": "trailing comments here carry load-bearing reasoning",

  // `i++` is used consistently across the loops that need a counter.
  "no-plusplus": "`i++` is used consistently and reads fine",

  // `shared/api.ts` uses `interface` deliberately: it is a contract meant to be
  // extended, and `interface` is what allows declaration merging.
  "@typescript-eslint/consistent-type-definitions":
    "shared/api.ts uses `interface` deliberately - it is an extensible contract",
  "typescript/consistent-type-definitions":
    "shared/api.ts uses `interface` deliberately - it is an extensible contract",

  // Rewrote `options(undefined)` to `options()` in the seam test, which is not
  // even a valid call - `options` takes a required parameter. The explicit
  // undefined was the thing under test: it is the case where the portal sent
  // nothing usable at all.
  "unicorn/no-useless-undefined":
    "the explicit `undefined` argument in the seam test is the case being tested",

  // Rewrote `innerText()` to `textContent()` throughout the smoke test's DOM
  // scraping. `textContent` is `string | null` where `innerText` is `string`, so
  // the rewrite does not compile - caught by tsc, not by oxlint. It is also a
  // different question: innerText is the rendered text, textContent is the raw
  // text, and the test reads what the user sees.
  "unicorn/prefer-dom-node-text-content":
    "the smoke test scrapes rendered text; textContent is nullable and is a different question",
};

const rules: Record<string, unknown> = { ...core.rules, ...react.rules };
for (const [rule, why] of Object.entries(OFF)) {
  if (rule in rules) rules[rule] = "off";
  else
    console.warn(
      `note: ${rule} is not a rule in this preset version, skipping`
    );
}

// `eqeqeq` is narrowed rather than disabled, so a real `==` on anything other
// than null still fails. ESLint has this exact option for the case.
rules.eqeqeq = ["error", "always", { null: "ignore" }];

const config = {
  $schema: "./node_modules/oxlint/configuration_schema.json",
  env: core.env,
  plugins: [...(core.plugins ?? []), ...(react.plugins ?? [])],
  ignorePatterns: core.ignorePatterns,
  rules,
  overrides: [
    ...Object.entries(core.overrides ?? {}).map(([files, value]) => ({
      files,
      ...value,
    })),
    {
      files: SERVER_SIDE,
      env: { browser: false, node: true },
    },
  ],
};

await writeFile(
  ".oxlintrc.json",
  `${JSON.stringify(config, null, 2)}\n`,
  "utf-8"
);
console.log(
  `wrote .oxlintrc.json: ${Object.values(rules).filter((r) => r !== "off").length} rules on, ` +
    `${Object.values(rules).filter((r) => r === "off").length} off, ` +
    `${config.plugins.length} plugins, ${config.overrides.length} override(s)`
);

/**
 * Markdown is excluded from the formatter on purpose.
 *
 * The Ultracite preset sets `proseWrap: "never"`, which does not mean "leave
 * prose alone" - it means "never wrap", so it *unwraps* every soft line break
 * already in the file. Run over this repository that deleted 579 lines across
 * nine markdown files, turning each hand-wrapped paragraph at 80 columns into a
 * single long line. These docs are read in a terminal and in diffs, where that
 * wrapping is the point, and they are prose rather than code, so a formatter has
 * no business rewriting them.
 *
 * The two generated configs are excluded for a different reason: the formatter
 * collapses short arrays onto one line while `JSON.stringify` expands them, so
 * leaving them in means `lint:config` and `lint:fix` undo each other on every
 * run. They are machine-written, so their layout is the generator's business.
 */
const GENERATED = ["**/*.md", ".oxlintrc.json", ".oxfmtrc.json"];
const formatter = {
  ...oxfmt,
  ignorePatterns: [...(oxfmt.ignorePatterns ?? []), ...GENERATED],
};

await writeFile(
  ".oxfmtrc.json",
  `${JSON.stringify(formatter, null, 2)}\n`,
  "utf-8"
);
console.log(
  `wrote .oxfmtrc.json: printWidth ${formatter.printWidth}, ` +
    `singleQuote ${formatter.singleQuote}, endOfLine ${formatter.endOfLine}, ` +
    `sortImports ${formatter.sortImports ? "on" : "off"}, ` +
    `markdown excluded (${formatter.ignorePatterns.length} patterns)`
);
