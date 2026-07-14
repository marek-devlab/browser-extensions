import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import type { BlurExtensionSettings, BlurSiteConfig } from '@blur/core';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startFixtureServer, type Fixture } from './server';

const EXT_PATH = fileURLToPath(
  new URL('../../extensions/blur/.output/chrome-mv3', import.meta.url),
);

export interface Blur {
  ctx: BrowserContext;
  extensionId: string;
  worker: Worker;
  /** Origin of the fixture HTTP server, e.g. http://127.0.0.1:53421 */
  origin: string;
  /** Overwrite global settings (chrome.storage.sync). Content scripts watch it. */
  setSettings(next: BlurExtensionSettings): Promise<void>;
  /** Overwrite per-site configs (chrome.storage.local). */
  setSiteConfigs(configs: Record<string, BlurSiteConfig>): Promise<void>;
  /** Overwrite the image-source allow/block rules (chrome.storage.local). */
  setImageSourceRules(rules: { never: string[]; always: string[] }): Promise<void>;
  /** Send a runtime message to a tab id (used to exercise message-driven paths). */
  sendToActiveTab(message: unknown): Promise<void>;
  /** Read global settings back out of storage. */
  getSettings(): Promise<BlurExtensionSettings>;
}

async function getExtensionWorker(ctx: BrowserContext): Promise<Worker> {
  const existing = ctx.serviceWorkers();
  return existing[0] ?? (await ctx.waitForEvent('serviceworker'));
}

export interface BlurFixtures {
  blur: Blur;
}

export const test = base.extend<BlurFixtures>({
  blur: async ({}, use) => {
    const fixture: Fixture = await startFixtureServer();
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'blur-e2e-'));

    // Extensions are most reliable in a headed persistent context. Headed by
    // default; set BLUR_HEADED=0 to attempt the new headless mode instead.
    const headed = process.env['BLUR_HEADED'] !== '0';
    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: !headed,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    const worker = await getExtensionWorker(ctx);
    const extensionId = new URL(worker.url()).host;

    const blur: Blur = {
      ctx,
      extensionId,
      worker,
      origin: fixture.origin,
      // Settings live in `local:` (moved off `sync:` so large keyword/allowlist
      // lists can't blow the 8 KB/item sync quota). The harness must write where
      // the extension reads.
      setSettings: (next) =>
        worker.evaluate(async (value) => {
          await chrome.storage.local.set({ settings: value });
        }, next),
      setSiteConfigs: (configs) =>
        worker.evaluate(async (value) => {
          await chrome.storage.local.set({ siteConfigs: value });
        }, configs),
      setImageSourceRules: (rules) =>
        worker.evaluate(async (value) => {
          await chrome.storage.local.set({ imageSourceRules: value });
        }, rules),
      sendToActiveTab: (message) =>
        worker.evaluate(async (msg) => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (typeof tab?.id === 'number') await chrome.tabs.sendMessage(tab.id, msg);
        }, message),
      getSettings: () =>
        worker.evaluate(async () => {
          const r = await chrome.storage.local.get('settings');
          return r['settings'] as BlurExtensionSettings;
        }),
    };

    // Known baseline before each test; individual tests override as needed.
    await blur.setSettings(DEFAULT_BLUR_SETTINGS);
    await blur.setSiteConfigs({});
    await blur.setImageSourceRules({ never: [], always: [] });

    await use(blur);

    await ctx.close();
    await fixture.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  },
});

export { expect } from '@playwright/test';
