import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  globalSetup: "./test/global-setup.ts",
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
    command: "bun server.ts",
    url: "http://127.0.0.1:8787",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
