import { defineConfig, devices } from "@playwright/test";

// Mobile smoke for the constellation. We stub /api/* in-browser so the test
// doesn't need a running backend or network; the goal is to assert that dots
// appear on a narrow viewport, which is what regressed on iOS Safari.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "iphone-12", use: { ...devices["iPhone 12"] } },
    { name: "pixel-5", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
