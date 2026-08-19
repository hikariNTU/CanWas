import { defineConfig, devices } from "@playwright/test";

/**
 * Overridable so a run can avoid a dev server that is already up — for example
 * one whose Vite dependency cache went stale after an install or uninstall.
 * Playwright starts its own server on any port it does not find one on.
 */
const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}/canwas/`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
