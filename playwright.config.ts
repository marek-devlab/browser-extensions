import { defineConfig } from '@playwright/test';

// Root Playwright config so `npx playwright test e2e/perf` works from the repo
// root. The perf extension e2e suite launches a headed persistent Chromium with
// the built MV3 extension loaded and drives it against local 127.0.0.1 fixtures.
export default defineConfig({
  testDir: './e2e',
  // The suite shares one browser context + fixture servers across tests, so it
  // must run in a single worker, serially.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
});
