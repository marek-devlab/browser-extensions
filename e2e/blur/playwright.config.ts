import { defineConfig } from '@playwright/test';

// The extension is loaded per-test via a persistent context in harness.ts, so no
// global `projects` browser config is needed here. Extensions run headed; keep
// workers at 1 so multiple headed Chromium windows don't race for resources.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  forbidOnly: !!process.env['CI'],
});
