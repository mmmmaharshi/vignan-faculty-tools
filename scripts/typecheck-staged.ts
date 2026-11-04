/**
 * Type-check every project, from the commit hook.
 *
 * The hook's own `vp check --fix` is lint and format only — it does not
 * type-check — and Playwright's global setup is the only other place that runs
 * `tsc`. A commit made without the suite therefore used to carry type errors
 * into history.
 *
 * lint-staged appends the staged filenames to every command it runs, and `tsc`
 * rejects that (`Option 'project' cannot be mixed …`), so this script ignores
 * its arguments and runs the project's own `typecheck`, which is what a person
 * runs by hand.
 */
const result = Bun.spawnSync(["bun", "run", "typecheck"], {
  stdio: ["ignore", "inherit", "inherit"],
});
if (result.exitCode !== 0) {
  console.error("\nType check failed — the commit was not made.");
  process.exit(result.exitCode ?? 1);
}
