import { defineConfig } from "@playwright/test";

/** Fast config for probes and single-file runs: skips the lint/typecheck/build
 *  gate in global-setup.ts. Use only when dist/ is already built and you are
 *  iterating on tests, not source. `bunx playwright test --config=playwright.fast.config.ts`. */
export default defineConfig({
  testDir: "./test",
  timeout: 180_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun server/server.ts",
    url: "http://127.0.0.1:8787",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
