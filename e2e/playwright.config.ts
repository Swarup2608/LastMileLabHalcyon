import { defineConfig, devices } from "@playwright/test";

// Run through e2e/run.sh (npm run test:e2e), which starts a throwaway stack and sets the E2E_* variables. The tests
// create logins and place orders, so never point E2E_BASE_URL at a database you want to keep.
export default defineConfig({
  testDir: "./tests",
  // The order flow and the shared logins change one database, so one test at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "app", testMatch: /\.spec\.ts/, dependencies: ["setup"] },
  ],
});
