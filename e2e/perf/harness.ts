import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { chromium, type BrowserContext, type Worker, type Page } from '@playwright/test';
import type { PageInsight } from '@blur/core';
import type {
  LongFrameSummary,
  PageTiming,
  PerfWebVital,
  TimedNetworkEntry,
} from '../../extensions/perf/utils/perf-types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXT_PATH = path.resolve(HERE, '../../extensions/perf/.output/chrome-mv3');

export interface Harness {
  context: BrowserContext;
  extensionId: string;
  /** An extension page (popup.html) used to query the background over messaging. */
  extPage: Page;
  close(): Promise<void>;
}

async function waitForServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers();
  if (existing[0]) return existing[0];
  return context.waitForEvent('serviceworker', { timeout: 15_000 });
}

export async function launch(): Promise<Harness> {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`Built extension not found at ${EXT_PATH}. Run: npm run build -w @blur/perf`);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const sw = await waitForServiceWorker(context);
  const extensionId = new URL(sw.url()).host;

  // A persistent extension page from which we can call chrome.runtime.sendMessage
  // to the background (a context does NOT receive its own sendMessage, so we can't
  // query from the service worker itself — an extension page is the reliable path).
  const extPage = await context.newPage();
  await extPage.goto(`chrome-extension://${extensionId}/popup.html`);

  return {
    context,
    extensionId,
    extPage,
    close: async () => {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

// The extension ships without the `tabs` permission (by design — narrow perms), so
// `chrome.tabs.query` returns tab *ids* but not their URLs. We therefore identify a
// freshly-opened fixture tab by diffing the set of tab ids before/after opening it.

/** Snapshot the current set of tab ids (always visible, no `tabs` permission needed). */
export async function tabIdsNow(extPage: Page): Promise<number[]> {
  return extPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => t.id).filter((id): id is number => typeof id === 'number');
  });
}

/** Vitals as the extension actually puts them on the wire: score + attribution detail. */
export async function getWebVitals(extPage: Page, tabId: number): Promise<PerfWebVital[]> {
  return extPage.evaluate(
    (id: number) => chrome.runtime.sendMessage({ type: 'getWebVitals', tabId: id }),
    tabId,
  ) as Promise<PerfWebVital[]>;
}

export async function getPageTiming(extPage: Page, tabId: number): Promise<PageTiming | null> {
  return extPage.evaluate(
    (id: number) => chrome.runtime.sendMessage({ type: 'getPageTiming', tabId: id }),
    tabId,
  ) as Promise<PageTiming | null>;
}

export async function getPageInsight(extPage: Page, tabId: number): Promise<PageInsight | null> {
  return extPage.evaluate(
    (id: number) => chrome.runtime.sendMessage({ type: 'getPageInsight', tabId: id }),
    tabId,
  ) as Promise<PageInsight | null>;
}

export async function getNetworkEntries(extPage: Page, tabId: number): Promise<TimedNetworkEntry[]> {
  return extPage.evaluate(
    (id: number) => chrome.runtime.sendMessage({ type: 'getNetworkEntries', tabId: id }),
    tabId,
  ) as Promise<TimedNetworkEntry[]>;
}

export async function getLongFrames(extPage: Page, tabId: number): Promise<LongFrameSummary> {
  return extPage.evaluate(
    (id: number) => chrome.runtime.sendMessage({ type: 'getLongFrames', tabId: id }),
    tabId,
  ) as Promise<LongFrameSummary>;
}

/** Poll until `predicate` holds or the timeout elapses. */
export async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (v: T) => boolean,
  { timeout = 12_000, interval = 300 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const start = Date.now();
  let last = await fn();
  while (!predicate(last)) {
    if (Date.now() - start > timeout) return last;
    await new Promise((r) => setTimeout(r, interval));
    last = await fn();
  }
  return last;
}
