import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

const SERVER_SIDE = ["server.ts", "portal-replies.ts", "shared/**"];
const OFF = {
  curly: "",
  "sort-keys": "",
  "no-eq-null": "",
  "react/todo": "",
  "require-unicode-regexp": "",
  complexity: "",
  "no-await-in-loop": "",
  "no-loop-func": "",
  "func-style": "",
  "no-inline-comments": "",
  "no-plusplus": "",
  "typescript/consistent-type-definitions": "",
  "unicorn/no-useless-undefined": "",
  "unicorn/prefer-dom-node-text-content": "",
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