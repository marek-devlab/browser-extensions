import { chromium } from 'playwright/test';
import type { BrowserContext, Page, Worker } from 'playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Shared harness for the Request Blocker Playwright specs (ui.spec.ts,
// integration.spec.ts). Everything here drives the PRODUCT through its own
// surfaces — the tool page, the popup, the message protocol, storage — never
// through test hooks in the extension.
//
// Facts this file is built on (plan docs/plans/netblock/03-integration.md §0):
//   - Playwright loads an MV3 extension only into a persistent Chromium
//     context; the background is `context.serviceWorkers()[0]` or the next
//     'serviceworker' event; the id is the host of its URL.
//   - `permissions.request` opens a NATIVE prompt that automation cannot
//     press, so a TEST COPY of the built manifest lists the fixture origins
//     under `host_permissions`. Everything after `permissions.getAll()` is the
//     production path; the shipped manifest is untouched (npm run guards).
//   - The real popup (`chrome.action.openPopup()`) is a `page` target Chrome
//     does not auto-attach for Playwright, so it is driven over a raw CDP
//     WebSocket (`--remote-debugging-port=0` → DevToolsActivePort). That is
//     the only way to assert the popup against a REAL active tab: popup.html
//     opened as a tab is itself the active tab (→ "restricted").
//   - The service worker is stopped with `ServiceWorker.stopAllWorkers` from
//     a page-level CDP session (microsoft/playwright#39075, 2026-02); the next
//     extension message wakes a fresh instance (in-memory state gone,
//     storage intact) — which is exactly what design §8 is about.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
export const BUILT_EXT = join(HERE, '..', '..', 'extensions', 'netblock', '.output', 'chrome-mv3');

export interface Extension {
  context: BrowserContext;
  extId: string;
  userDataDir: string;
  /** Console/page errors collected from every watched page (and popups). */
  errors: string[];
  worker(): Promise<Worker>;
  cdp(): Promise<RawCdp>;
  close(): Promise<void>;
}

export interface LoadOptions {
  /** Origins (match patterns) to grant install-time in the TEST COPY of the manifest. */
  grantOrigins?: string[];
  tag?: string;
}

export async function loadExtension(opts: LoadOptions = {}): Promise<Extension> {
  if (!existsSync(join(BUILT_EXT, 'manifest.json'))) {
    throw new Error(`no build at ${BUILT_EXT} — run \`npm run build:netblock\` first`);
  }
  const tag = opts.tag ?? 'netblock';
  let extDir = BUILT_EXT;
  let extCopy: string | null = null;
  if (opts.grantOrigins?.length) {
    extCopy = mkdtempSync(join(tmpdir(), `${tag}-ext-`));
    cpSync(BUILT_EXT, extCopy, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(extCopy, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    manifest.host_permissions = opts.grantOrigins;
    writeFileSync(join(extCopy, 'manifest.json'), JSON.stringify(manifest));
    extDir = extCopy;
  }
  const userDataDir = mkdtempSync(join(tmpdir(), `${tag}-profile-`));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: false,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=DialMediaRouteProvider',
      // Raw CDP endpoint for the real popup (see header).
      '--remote-debugging-port=0',
    ],
  });
  const errors: string[] = [];
  const first = await getWorker(context);
  const extId = new URL(first.url()).host;
  let raw: RawCdp | null = null;
  return {
    context,
    extId,
    userDataDir,
    errors,
    worker: () => getWorker(context),
    async cdp() {
      if (!raw) raw = await RawCdp.connect(userDataDir);
      return raw;
    },
    async close() {
      raw?.close();
      await context.close().catch(() => undefined);
      rmSync(userDataDir, { recursive: true, force: true });
      if (extCopy) rmSync(extCopy, { recursive: true, force: true });
    },
  };
}

export async function getWorker(ctx: BrowserContext): Promise<Worker> {
  const existing = ctx.serviceWorkers();
  if (existing[0]) return existing[0];
  return ctx.waitForEvent('serviceworker', { timeout: 30_000 });
}

/** Collect console errors + page errors — asserted to be empty at the end.
 *  On a FIXTURE page the browser's own "Failed to load resource" lines are the
 *  product working (blocked images, failed fetches, a missing favicon), so
 *  only script errors count there; extension pages stay strict. */
export function watch(page: Page, errors: string[], opts: { fixture?: boolean } = {}): void {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (opts.fixture && /^Failed to load resource/.test(m.text())) return;
    errors.push(`[${page.url()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${page.url()}] pageerror: ${e.message}`));
}

export async function openTool(ext: Extension, hash = '#/rules'): Promise<Page> {
  const page = await ext.context.newPage();
  watch(page, ext.errors);
  await page.goto(`chrome-extension://${ext.extId}/tool.html${hash}`);
  await page.waitForSelector('.tool');
  return page;
}

/** Ask the background through an extension page's runtime — the UI's own path. */
export async function query<T = unknown>(page: Page, msg: Record<string, unknown>): Promise<T> {
  return page.evaluate((m) => (globalThis as unknown as { chrome: typeof chrome }).chrome.runtime.sendMessage(m), msg) as Promise<T>;
}

/** A rule document entry with the defaults the schema expects. */
export function rule(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: id,
    enabled: true,
    priority: 0,
    createdAt: 1,
    scope: 'all',
    countKey: 'rule+tab',
    resetOn: 'navigation',
    engine: 'auto',
    condition: { url: { op: 'contains', value: `/api/${id}` }, resourceTypes: ['xhr'] },
    state: { kind: 'every' },
    action: { type: 'block' },
    ...over,
  };
}

/** Replace the rule document through `importRules` (validated by the background). */
export async function seedRules(page: Page, rules: Record<string, unknown>[]): Promise<void> {
  const r = await query<{ ok: boolean; imported: number; errors: unknown[] }>(page, {
    type: 'importRules',
    mode: 'replace',
    text: JSON.stringify({ version: 1, groups: [], rules }),
  });
  if (!r.ok || r.imported !== rules.length) throw new Error(`seedRules: ${JSON.stringify(r)}`);
}

export async function tabIdOf(ext: Extension, urlPrefix: string): Promise<number> {
  const w = await ext.worker();
  const id = await w.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith(u))?.id, urlPrefix);
  if (typeof id !== 'number') throw new Error(`no tab for ${urlPrefix}`);
  return id;
}

/* -------------------------------- raw CDP -------------------------------- */

type CdpMessage = { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; result?: unknown; error?: { message: string } };

/** Minimal CDP client over the browser's DevTools WebSocket (Node ≥ 22 has a global WebSocket). */
export class RawCdp {
  private id = 0;
  private readonly pending = new Map<number, (m: CdpMessage) => void>();
  private readonly listeners = new Set<(m: CdpMessage) => void>();

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (e: MessageEvent) => {
      const m = JSON.parse(String(e.data)) as CdpMessage;
      if (m.id !== undefined && this.pending.has(m.id)) {
        this.pending.get(m.id)!(m);
        this.pending.delete(m.id);
      } else if (m.method) {
        for (const l of this.listeners) l(m);
      }
    };
  }

  static async connect(userDataDir: string): Promise<RawCdp> {
    let text = '';
    for (let i = 0; i < 50 && !text; i++) {
      try {
        text = readFileSync(join(userDataDir, 'DevToolsActivePort'), 'utf8');
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const [port, path] = text.split(/\r?\n/);
    if (!port || !path) throw new Error('DevToolsActivePort not found — was Chromium launched with --remote-debugging-port=0?');
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error('CDP websocket failed'));
    });
    return new RawCdp(ws);
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((res, rej) => {
      this.pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result as T)));
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(cb: (m: CdpMessage) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async targets(): Promise<{ targetId: string; type: string; url: string }[]> {
    const r = await this.send<{ targetInfos: { targetId: string; type: string; url: string }[] }>('Target.getTargets');
    return r.targetInfos;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

/* --------------------------------- popup --------------------------------- */

/** The REAL popup (opened with `chrome.action.openPopup()`), driven over raw CDP. */
export class Popup {
  private unsubscribe: (() => void) | null = null;

  private constructor(
    private readonly cdp: RawCdp,
    private readonly sessionId: string,
    readonly targetId: string,
  ) {}

  static async open(ext: Extension, forPage: Page): Promise<Popup> {
    // The popup summarises the ACTIVE tab of the focused window.
    await forPage.bringToFront();
    const w = await ext.worker();
    const r = await w.evaluate(async () => {
      try {
        await chrome.action.openPopup();
        return 'ok';
      } catch (e) {
        return `err:${(e as Error).message}`;
      }
    });
    if (r !== 'ok') throw new Error(`chrome.action.openPopup: ${r}`);
    const cdp = await ext.cdp();
    let target: { targetId: string } | undefined;
    for (let i = 0; i < 50 && !target; i++) {
      target = (await cdp.targets()).find((t) => t.type === 'page' && t.url.includes('/popup.html'));
      if (!target) await new Promise((res) => setTimeout(res, 100));
    }
    if (!target) throw new Error('popup target did not appear');
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const popup = new Popup(cdp, sessionId, target.targetId);
    // Console errors of the popup count like every other page's.
    await cdp.send('Runtime.enable', {}, sessionId);
    popup.unsubscribe = cdp.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') {
        const d = (m.params as { exceptionDetails?: { text?: string; exception?: { description?: string } } }).exceptionDetails;
        ext.errors.push(`[popup] ${d?.exception?.description ?? d?.text ?? 'exception'}`);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        const p = m.params as { type?: string; args?: { value?: unknown; description?: string }[] };
        if (p.type === 'error') ext.errors.push(`[popup] ${(p.args ?? []).map((a) => a.value ?? a.description).join(' ')}`);
      }
    });
    // Rendered + first summary in.
    await popup.waitFor(`!!document.querySelector('[data-testid="host"]') && document.querySelector('[data-testid="host"]').textContent !== '—'`, 10_000).catch(() => undefined);
    return popup;
  }

  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.cdp.send<{ result: { value?: T }; exceptionDetails?: { text?: string } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      this.sessionId,
    );
    if (r.exceptionDetails) throw new Error(`popup eval: ${r.exceptionDetails.text ?? 'exception'} in ${expression}`);
    return r.result.value as T;
  }

  text(selector: string): Promise<string | null> {
    return this.eval<string | null>(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? null)`);
  }

  exists(selector: string): Promise<boolean> {
    return this.eval<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`);
  }

  /** A DOM click — React handlers fire as for a user click (no gesture is needed for this UI). */
  async click(selector: string): Promise<void> {
    const ok = await this.eval<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`popup: nothing to click at ${selector}`);
  }

  /** Click the first `selector` element whose trimmed text equals `text`. */
  async clickText(selector: string, text: string): Promise<void> {
    const ok = await this.eval<boolean>(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`,
    );
    if (!ok) throw new Error(`popup: no ${selector} with text "${text}"`);
  }

  /** Poll a JS predicate in the popup until truthy. */
  async waitFor(predicate: string, timeoutMs = 8000): Promise<void> {
    const t0 = Date.now();
    for (;;) {
      if (await this.eval<boolean>(`!!(${predicate})`)) return;
      if (Date.now() - t0 > timeoutMs) {
        const body = await this.eval<string>('document.body.innerText.slice(0, 400)').catch(() => '(gone)');
        throw new Error(`popup: timed out waiting for ${predicate}
--- popup text ---
${body}`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  /** Text of a rule row's counter cell, e.g. `2/3`, `≈1`, `—`. */
  async counter(ruleId: string): Promise<string> {
    const t = await this.text(`[data-rule-id="${ruleId}"] .prow__count`);
    return (t ?? '').replace('↻', '').trim();
  }

  async isOpen(): Promise<boolean> {
    return (await this.cdp.targets()).some((t) => t.targetId === this.targetId);
  }

  async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => undefined);
  }
}

/* ------------------------------ service worker ---------------------------- */

/** Terminate the extension's background worker (design §8 "SW stopped mid-sequence"). */
export async function stopServiceWorker(ext: Extension, page: Page): Promise<void> {
  const cdp = await ext.context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
