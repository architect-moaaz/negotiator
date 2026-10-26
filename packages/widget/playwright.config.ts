import { defineConfig, devices } from "@playwright/test";

/**
 * The widget on real browsers, on the kinds of page sellers paste it into. Hermetic: the host pages,
 * the widget script and GhostCart's API are all served by request interception, so no server is needed.
 */
export default defineConfig({
  testDir: "./test",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
