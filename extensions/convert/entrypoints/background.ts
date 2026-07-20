import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import { localeItem } from '../utils/storage';
import { tAt, type MsgKey } from '../utils/i18n';
import { parseQuantity, lookupUnitToken, lookupCurrencyToken, type Parsed } from '../utils/parse';
import { getCategory, getUnit, convertUnit, type UnitTag } from '../utils/units';
import { formatNumber } from '../utils/format';
import { readSnapshot, refreshRates, convertMoney, CURRENCY_CODES, CRYPTO_SET } from '../utils/rates';
import type { Locale } from '@blur/ui';

// The service worker's whole job (PLAN.md §11.1, §11.6):
//   - fetch the currency/crypto rate TABLES (never the user's amount) and cache
//     them, on install/startup and on the popup's explicit "Refresh" message;
//   - the "Convert selection" context menu → inject a dismissable result badge on
//     the active tab (activeTab gesture + scripting, NOT a standing content script);
//   - the `cv` omnibox keyword → show the answer inline in suggestions.
//
// 🔴 No amount ever leaves the device: currency math runs here (or in the popup)
// against the cached table. The badge shows only locally-computed results.
//
// MV3 survival: every listener is registered at the TOP LEVEL so a recycled worker
// is woken by them; no state is held in SW memory; the menu is (re)created on
// install AND on every startup.

const MENU_ID = 'convert-selection';
const BADGE_PRECISION = 6;
const BADGE_MAX_LINES = 8;

async function currentLocale(): Promise<Locale> {
  return localeItem.getValue().catch(() => 'en' as const);
}

function tagSuffix(locale: Locale, tag: UnitTag | undefined): string {
  return tag ? ` (${tAt(locale, `tag_${tag}` as MsgKey)})` : '';
}

/* -------------------------------------------------------------------------- */
/* Result rendering — shared by the badge and the omnibox.                     */
/* -------------------------------------------------------------------------- */

interface RenderedResult {
  header: string;
  lines: string[];
  attribution?: string;
  hint?: string;
  empty?: string;
}

async function renderResult(parsed: Parsed | null, locale: Locale): Promise<RenderedResult> {
  if (!parsed) return { header: '', lines: [], empty: tAt(locale, 'badgeNoParse') };

  if (parsed.kind === 'unit') {
    const cat = getCategory(parsed.category);
    const from = getUnit(parsed.category, parsed.unitId);
    if (!cat || !from) return { header: '', lines: [], empty: tAt(locale, 'badgeNoParse') };
    const header = `${formatNumber(parsed.value, locale, BADGE_PRECISION)} ${from.symbol}${tagSuffix(locale, from.tag)} =`;
    const lines: string[] = [];
    for (const u of cat.units) {
      if (u.id === parsed.unitId) continue;
      const out = convertUnit(parsed.category, parsed.value, parsed.unitId, u.id);
      if (out === null) continue;
      lines.push(`${formatNumber(out, locale, BADGE_PRECISION)} ${u.symbol}${tagSuffix(locale, u.tag)}`);
      if (lines.length >= BADGE_MAX_LINES) break;
    }
    return { header, lines };
  }

  // Currency / crypto — needs the cached snapshot.
  const snapshot = await readSnapshot();
  if (!snapshot.usdPer[parsed.code]) {
    return { header: '', lines: [], hint: tAt(locale, 'badgeCurrencyHint') };
  }
  const header = `${formatNumber(parsed.value, locale, BADGE_PRECISION)} ${parsed.code} =`;
  const lines: string[] = [];
  let usedCrypto = CRYPTO_SET.has(parsed.code);
  for (const code of CURRENCY_CODES) {
    if (code === parsed.code) continue;
    const out = convertMoney(snapshot, parsed.value, parsed.code, code);
    if (out === null) continue;
    lines.push(`${formatNumber(out, locale, BADGE_PRECISION)} ${code}`);
    if (CRYPTO_SET.has(code)) usedCrypto = true;
    if (lines.length >= 6) break;
  }
  return {
    header,
    lines,
    attribution: usedCrypto ? tAt(locale, 'coingecko') : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Context menu → inject the badge.                                            */
/* -------------------------------------------------------------------------- */

async function createMenu(): Promise<void> {
  const locale = await currentLocale();
  browser.contextMenus.create(
    {
      id: MENU_ID,
      title: tAt(locale, 'ctxConvertSelection'),
      // `contexts: ['selection']` — we read `info.selectionText` directly; no host
      // permission is needed for the parse, only activeTab for the badge injection.
      contexts: ['selection'],
    },
    () => {
      void browser.runtime.lastError; // silence the benign duplicate-id on re-create
    },
  );
}

function refreshMenuTitle(): void {
  void currentLocale().then((locale) => {
    browser.contextMenus.update(MENU_ID, { title: tAt(locale, 'ctxConvertSelection') }, () => {
      void browser.runtime.lastError;
    });
  });
}

interface BadgePayload {
  title: string;
  header: string;
  lines: string[];
  footer: string;
  attribution?: string;
  hint?: string;
  empty?: string;
  dismiss: string;
}

// 🔴 Runs in the PAGE. Self-contained (no imports/closures) so it survives being
// serialised into `executeScript`. Builds every node with createElement +
// textContent — NEVER innerHTML — inside a CLOSED shadow root so the page cannot
// read or restyle it and our styles cannot leak into the page.
function badgeMain(payload: BadgePayload): void {
  const MARK = 'data-blur-convert-badge';
  document.querySelectorAll(`[${MARK}]`).forEach((n) => n.remove());

  const host = document.createElement('div');
  host.setAttribute(MARK, '');
  const shadow = host.attachShadow({ mode: 'closed' });
  document.documentElement.appendChild(host);

  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const style = document.createElement('style');
  style.textContent =
    ':host{all:initial}' +
    '.b{position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;' +
    'font:400 13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;' +
    `background:${dark ? '#1b1f24' : '#ffffff'};color:${dark ? '#e8eaed' : '#16181d'};` +
    `border:1px solid ${dark ? '#3c4043' : '#d5d9e0'};border-left:4px solid #1a73e8;` +
    'border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.3);padding:10px 12px}' +
    '.t{font-weight:700;font-size:12px;margin:0 0 4px;color:#1a73e8}' +
    '.h{margin:0 0 4px;font-weight:600}' +
    '.l{margin:2px 0;font-variant-numeric:tabular-nums}' +
    `.f{margin:6px 0 0;font-size:11px;color:${dark ? '#9aa0a6' : '#5f6570'}}` +
    '.x{position:absolute;top:6px;right:8px;background:transparent;border:none;cursor:pointer;' +
    `font-size:16px;line-height:1;color:${dark ? '#9aa0a6' : '#5f6570'};min-width:24px;min-height:24px}`;
  shadow.appendChild(style);

  const box = document.createElement('div');
  box.className = 'b';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'x';
  close.textContent = '×';
  close.setAttribute('aria-label', payload.dismiss);
  close.addEventListener('click', () => host.remove());
  box.appendChild(close);

  const title = document.createElement('p');
  title.className = 't';
  title.textContent = payload.title;
  box.appendChild(title);

  if (payload.empty || payload.hint) {
    const p = document.createElement('p');
    p.className = 'h';
    p.textContent = payload.empty || payload.hint || '';
    box.appendChild(p);
  } else {
    const h = document.createElement('p');
    h.className = 'h';
    h.textContent = payload.header;
    box.appendChild(h);
    for (const line of payload.lines) {
      const p = document.createElement('p');
      p.className = 'l';
      p.textContent = line;
      box.appendChild(p);
    }
    const f = document.createElement('p');
    f.className = 'f';
    f.textContent = payload.footer + (payload.attribution ? ' · ' + payload.attribution : '');
    box.appendChild(f);
  }

  shadow.appendChild(box);
  window.setTimeout(() => host.remove(), 15000);
}

async function injectBadge(tabId: number, payload: BadgePayload): Promise<void> {
  try {
    // Chrome MV3 / Firefox MV3: the `scripting` API with a serialisable func.
    const scripting = (browser as { scripting?: typeof browser.scripting }).scripting;
    if (scripting?.executeScript) {
      await scripting.executeScript({ target: { tabId }, func: badgeMain, args: [payload] });
      return;
    }
    // Firefox MV2: no `scripting` API — `tabs.executeScript` runs from activeTab.
    const legacy = (browser.tabs as { executeScript?: (id: number, d: { code: string }) => Promise<unknown> })
      .executeScript;
    if (legacy) {
      await legacy(tabId, { code: `(${badgeMain.toString()})(${JSON.stringify(payload)})` });
    }
  } catch {
    // A restricted page (chrome://, the Web Store, view-source) rejects injection.
    // Fail-safe: nothing renders; no error is surfaced to the page.
  }
}

async function handleSelection(tabId: number, selectionText: string): Promise<void> {
  const locale = await currentLocale();
  const parsed = parseQuantity(selectionText);
  const result = await renderResult(parsed, locale);
  await injectBadge(tabId, {
    title: tAt(locale, 'badgeTitle'),
    header: result.header,
    lines: result.lines,
    footer: tAt(locale, 'badgeLocally'),
    attribution: result.attribution,
    hint: result.hint,
    empty: result.empty,
    dismiss: tAt(locale, 'badgeDismiss'),
  });
}

/* -------------------------------------------------------------------------- */
/* Omnibox — "cv 5 mi to km".                                                  */
/* -------------------------------------------------------------------------- */

/** Split "5 mi to km" into the amount+source fragment and the target token. */
function splitToTarget(text: string): { left: string; target: string | null } {
  const m = text.split(/\s+(?:to|in|->|→|в)\s+/i);
  if (m.length >= 2) return { left: m[0]!.trim(), target: m[m.length - 1]!.trim() };
  return { left: text.trim(), target: null };
}

async function omniboxAnswer(text: string, locale: Locale): Promise<string | null> {
  const { left, target } = splitToTarget(text);
  const parsed = parseQuantity(left);
  if (!parsed) return null;

  if (parsed.kind === 'unit') {
    let toId = target ? lookupUnitToken(target)?.unitId : undefined;
    // If no explicit target, pick the first different unit in the category.
    const cat = getCategory(parsed.category);
    if (!cat) return null;
    if (!toId) toId = cat.units.find((u) => u.id !== parsed.unitId)?.id;
    if (!toId) return null;
    const out = convertUnit(parsed.category, parsed.value, parsed.unitId, toId);
    if (out === null) return null;
    const from = getUnit(parsed.category, parsed.unitId);
    const to = getUnit(parsed.category, toId);
    return `${formatNumber(parsed.value, locale, BADGE_PRECISION)} ${from?.symbol ?? ''} = ${formatNumber(out, locale, BADGE_PRECISION)} ${to?.symbol ?? ''}`;
  }

  // Currency
  const snapshot = await readSnapshot();
  const toCode = target ? lookupCurrencyToken(target) : 'USD';
  if (!toCode || !snapshot.usdPer[parsed.code] || !snapshot.usdPer[toCode]) return null;
  const out = convertMoney(snapshot, parsed.value, parsed.code, toCode);
  if (out === null) return null;
  return `${formatNumber(parsed.value, locale, BADGE_PRECISION)} ${parsed.code} = ${formatNumber(out, locale, BADGE_PRECISION)} ${toCode}`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void createMenu();
    void refreshRates(false);
  });
  // ...and on every SW startup.
  void createMenu();
  void refreshRates(false);

  localeItem.watch(() => refreshMenuTitle());

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab?.id || !info.selectionText) return;
    void handleSelection(tab.id, info.selectionText);
  });

  // Omnibox: default hint + live answer in the suggestion description.
  const omnibox = (browser as { omnibox?: typeof browser.omnibox }).omnibox;
  if (omnibox) {
    omnibox.setDefaultSuggestion?.({ description: tAt('en', 'omniDefault') });
    omnibox.onInputChanged?.addListener((text: string, suggest: (s: { content: string; description: string }[]) => void) => {
      void (async () => {
        const locale = await currentLocale();
        const answer = await omniboxAnswer(text, locale);
        if (answer) {
          suggest([{ content: answer, description: xmlEscape(answer) }]);
        } else {
          suggest([{ content: text, description: xmlEscape(tAt(locale, 'omniNoParse')) }]);
        }
      })();
    });
    omnibox.onInputEntered?.addListener((text: string) => {
      // Open the popup page as a tab with the query prefilled, so the result can be
      // copied and refined. (The address bar cannot itself display our result.)
      const url = browser.runtime.getURL(`/popup.html#q=${encodeURIComponent(text)}`);
      void browser.tabs.create({ url });
    });
  }

  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (r: unknown) => void) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === 'convert:refreshRates') {
        const force = Boolean((message as { force?: boolean }).force);
        void refreshRates(force).then(sendResponse);
        return true;
      }
      return undefined;
    },
  );
});
