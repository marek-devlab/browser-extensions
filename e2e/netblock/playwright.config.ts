import { defineConfig } from 'playwright/test';

// Headed, single-worker (same shape as e2e/seo): the built Chrome extension is
// loaded unpacked into a persistent context, and extensions do not load in
// headless-shell, so `headless` is forced off inside the spec's
// launchPersistentContext call. Build first: `npm run build:netblock`.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    trace: 'off',
  },
});
