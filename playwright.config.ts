import { defineConfig } from "@playwright/test";

// The suite drives the built front end the same way a faculty member does, so
// `dist/` has to exist first. The `test` script builds it.
export default defineConfig({
  testDir: "./test",
  // Every step is a live round trip to the ECAP portal, which is slow but never
  // takes minutes. Generous, because a timeout here reads as a failure when it
  // is really just the portal being slow.
  timeout: 180_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1, // one browser and one portal session at a time
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun server.ts",
    url: "http://127.0.0.1:8787",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
