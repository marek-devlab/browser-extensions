import { defineConfig } from 'playwright/test';

// Headed, single-worker: the extension is loaded via a persistent context and
// the a11y audit needs a real Chromium (axe-core's colour-contrast rule reads
// computed styles). Extensions do not load in headless-shell, so `headless` is
// forced off inside the spec's launchPersistentContext call.
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
