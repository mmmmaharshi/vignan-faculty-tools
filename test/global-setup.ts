import { execFileSync } from "node:child_process";

/**
 * Typecheck before any test runs, however the runner was invoked.
 *
 * This started as a `pretest` hook in package.json, which was not enough:
 * `pretest` only fires for `bun run test`, so `bunx playwright test` and
 * `bun run build` both skipped the gate - and the gate is the only thing
 * verifying the contract in `shared/api.ts`, which nothing else in the
 * toolchain checks. Playwright loads `globalSetup` for every invocation, so
 * this is the one place the check cannot be routed around.
 *
 * `tsc` is resolved through `bunx` rather than a relative path to the binary,
 * because the binary's location and extension differ by package manager and
 * platform, and a hardcoded one breaks on the first machine that disagrees.
 */

const PROJECTS = [
  "tsconfig.json",
  "tsconfig.server.json",
  "tsconfig.test.json",
];

export default function globalSetup(): void {
  for (const project of PROJECTS) {
    // stdio: inherit so a failure prints tsc's own diagnostics and file:line,
    // rather than an opaque non-zero exit.
    execFileSync("bunx", ["tsc", "-p", project], { stdio: "inherit" });
  }
}
