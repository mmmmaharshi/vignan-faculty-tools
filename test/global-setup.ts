import { execFileSync } from "node:child_process";

/**
 * Lint and typecheck before any test runs, however the runner was invoked.
 *
 * This started as a `pretest` hook in package.json, which was not enough:
 * `pretest` only fires for `bun run test`, so `bunx playwright test` and
 * `bun run build` both skipped the gate. Playwright loads `globalSetup` for every
 * invocation, so this is the one place the checks cannot be routed around.
 *
 * That matters more than usual here, because these two are the only things
 * verifying anything at all. Nothing else in the toolchain typechecks - Vite and
 * Playwright both use esbuild, which strips types without reading them - and
 * nothing else lints. A gate that only runs when a human remembers is not
 * enforcing anything; it is advice.
 *
 * Lint runs first because it is roughly twenty times faster than the typecheck,
 * so a style mistake fails in milliseconds rather than after three tsc passes.
 *
 * Both tools are resolved through `bunx` rather than a relative path to their
 * binaries, because those paths differ by package manager and platform, and a
 * hardcoded one breaks on the first machine that disagrees.
 */

const PROJECTS = [
  "tsconfig.json",
  "tsconfig.server.json",
  "tsconfig.test.json",
];

/** stdio: inherit so a failure prints the tool's own file:line diagnostics. */
const run = (command: string, args: string[]): void => {
  execFileSync("bunx", [command, ...args], { stdio: "inherit" });
};

export default function globalSetup(): void {
  run("ultracite", ["check"]);
  for (const project of PROJECTS) {
    run("tsc", ["-p", project]);
  }
}
