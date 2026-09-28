import { execFileSync } from "node:child_process";

/**
 * Lint, typecheck, then build - before any test runs, however it was invoked.
 *
 * This started as a `pretest` hook in package.json, which was not enough:
 * `pretest` only fires for `bun run test`, so `bunx playwright test` skipped the
 * gate entirely. Playwright loads `globalSetup` for every invocation, so this is
 * the one place the checks cannot be routed around.
 *
 * That matters more than usual here, because these are the only things
 * verifying anything at all. Nothing else in the toolchain typechecks - Vite and
 * Playwright both use esbuild, which strips types without reading them - and
 * nothing else lints. A gate that only runs when a human remembers is not
 * enforcing anything; it is advice.
 *
 * **The build is here too, and it was in the wrong place.** It used to be
 * `bun run build && playwright test`, which put a 900ms build *ahead* of the
 * gate - and a build does not fail on a type error, because esbuild never reads
 * the types. So a type error used to write `dist/` before the gate noticed, and
 * `bunx playwright test` skipped the build altogether and tested whatever bundle
 * happened to be on disk. Both are the same bug: the tests were not necessarily
 * running against the code being tested.
 *
 * Order is lint, typecheck, build. Lint first because it is the cheapest failure.
 * The build last because it is the only step that writes anything, so it should
 * never run on code already known to be wrong.
 *
 * Every tool is resolved through `bunx` rather than a relative path to its
 * binary, because those paths differ by package manager and platform, and a
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
  run("vite", ["build"]);
}
