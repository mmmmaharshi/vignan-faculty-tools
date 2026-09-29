import react from "@vitejs/plugin-react";
import oxfmt from "ultracite/oxfmt";
import core from "ultracite/oxlint/core";
import reactPreset from "ultracite/oxlint/react";
import { defineConfig, lazyPlugins } from "vite-plus";

const SERVER_SIDE = ["server.ts", "portal-replies.ts", "shared/**"];
const OFF: Record<string, "off"> = {
  curly: "off",
  "sort-keys": "off",
  "no-eq-null": "off",
  "react/todo": "off",
  "require-unicode-regexp": "off",
  complexity: "off",
  "no-await-in-loop": "off",
  "no-loop-func": "off",
  "func-style": "off",
  "no-inline-comments": "off",
  "no-plusplus": "off",
  "typescript/consistent-type-definitions": "off",
  "unicorn/no-useless-undefined": "off",
  "unicorn/prefer-dom-node-text-content": "off",
  "unicorn/filename-case": "off",
};
const rules = { ...core.rules, ...reactPreset.rules };
for (const rule of Object.keys(OFF)) {
  if (rule in rules) rules[rule] = OFF[rule];
}
rules.eqeqeq = ["error", "always", { null: "ignore" }];
const GENERATED = ["**/*.md"];

export default defineConfig({
  run: {
    tasks: {
      api: {
        // --watch, because the front end reloads on save and the API should not
        // be the one thing that needs a manual restart. A restart reloads the
        // session from the vault, so nobody is signed out by saving a file.
        command: "bun --watch server.ts",
        cache: false,
      },
      "dev:all": {
        command: "vp dev",
        dependsOn: ["api"],
        cache: false,
      },
    },
  },
  staged: {
    "**/*": "vp check --fix",
  },
  fmt: {
    ...oxfmt,
    ignorePatterns: [...(oxfmt.ignorePatterns ?? []), ...GENERATED],
  },
  lint: {
    env: core.env,
    plugins: [...(core.plugins ?? []), ...(reactPreset.plugins ?? [])],
    ignorePatterns: core.ignorePatterns,
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { ...rules, "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: false, typeCheck: false },
    overrides: [
      ...(core.overrides ?? []),
      { files: SERVER_SIDE, env: { browser: false, node: true } },
    ],
  },
  root: "web",
  base: "/",
  plugins: lazyPlugins(() => [react()]),
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
