import { defineUnlistedScript } from '#imports';
import { browser } from 'wxt/browser';
import { openExportDialog } from '../utils/export-dialog';
import {
  copyText,
  isSafeAssetUrl,
  resolveCurrentSrc,
  saveImage,
  saveTextParts,
} from '../utils/file-writer';
import { safeFilename } from '../utils/file-writer';
import { MIME } from '../utils/csv-guard';
import { pickElements, type Candidate } from '../utils/picker';
import { readSelection } from '../utils/selection-md';
import {
  buildTableModel,
  defaultExtractOptions,
  scanPageInventory,
  scanTables,
} from '../utils/table-extract';
import { destroyOverlay, el, getHost, overlayExists, setOverlayLocale, showToast, type OverlayTheme } from '../utils/overlay';
import { localeItem, prefsItem } from '../utils/storage';
import { tAt } from '../utils/i18n';
import type { Locale } from '@blur/ui';
import type { BgRequest, BgResponse, EngineCommand, EngineResponse } from '../utils/messages';
import type { ExportPrefs, ExtractOptions, TableModel } from '../utils/types';

// `engine.js` — injected ON A GESTURE by the background (or the popup) via
// scripting.executeScript under the `activeTab` grant (design §0). NEVER a
// persistent content script: nothing of ours runs on any page until the user asks.
//
// It is idempotent (§9.5): a second injection re-registers nothing and focuses the
// existing overlay instead of stacking a second one.
//
// 🔴 It holds no privileged APIs. `tabs.create`, `downloads`, `permissions` and the
// second (xlsx) injection all go through the background via `ask()`.

const INSTALLED = '__blurExportEngineInstalled__';

export default defineUnlistedScript(() => {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[INSTALLED]) {
    // Re-injection while an overlay is open → focus it, do not build a second one.
    if (overlayExists()) return;
  } else {
    g[INSTALLED] = true;
    browser.runtime.onMessage.addListener(
      (msg: unknown, _sender: unknown, sendResponse: (r: EngineResponse) => void) => {
        handle(msg as EngineCommand)
          .then(sendResponse)
          .catch((e: unknown) =>
            sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
          );
        return true; // async response
      },
    );
  }
});

// The active UI language, read from the persisted pref at the start of every
// command (handle) and mirrored to the overlay/picker. Defaults to English until
// the first read resolves.
let engineLocale: Locale = 'en';

/** The engine's only channel to privileged APIs. */
async function ask(req: BgRequest): Promise<BgResponse> {
  try {
    const res = (await browser.runtime.sendMessage(req)) as BgResponse | undefined;
    return res ?? { ok: false, error: tAt(engineLocale, 'bgNoResponse') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function getPrefs(): Promise<ExportPrefs> {
  return prefsItem.getValue();
}

// §5.11 — the user navigated away while we were building a 60 000-cell matrix.
// Abort the chunked extraction; the Blob-URL registry (file-writer.ts) revokes on
// the same event. No phantom files, no work on a dead page.
//
// Lazily created: WXT imports entrypoint modules in NODE at build time to read
// their config, and there is no `addEventListener` there.
let pageLeaving: AbortController | undefined;
function leaveSignal(): AbortSignal {
  if (!pageLeaving) {
    pageLeaving = new AbortController();
    addEventListener('pagehide', () => pageLeaving?.abort(), { once: true });
  }
  return pageLeaving.signal;
}

function extractOptionsFrom(prefs: ExportPrefs, locale: Locale): ExtractOptions {
  return defaultExtractOptions({
    mergedCells: prefs.mergedCells,
    visibleRowsOnly: prefs.visibleRowsOnly,
    linksInCells: prefs.linksInCells,
    signal: leaveSignal(),
    // Localized labels the extractor writes into cells/headers of the exported file.
    checkboxYes: tAt(locale, 'checkboxYes'),
    checkboxNo: tAt(locale, 'checkboxNo'),
    columnFallback: tAt(locale, 'columnFallback'),
  });
}

async function handle(cmd: EngineCommand): Promise<EngineResponse> {
  const prefs = await getPrefs();
  engineLocale = await localeItem.getValue();
  setOverlayLocale(engineLocale);
  const locale = engineLocale;
  const t = (k: Parameters<typeof tAt>[1], v?: Record<string, string | number>): string =>
    tAt(locale, k, v);
  const theme = prefs.theme as OverlayTheme;
  const opts = extractOptionsFrom(prefs, locale);

  switch (cmd.type) {
    case 'ping':
      return { ok: true, kind: 'done' };

    case 'scan':
      // The popup's live read. No overlay, no side effects (design §2.4).
      return { ok: true, kind: 'scan', inventory: await scanPageInventory(opts) };

    case 'exportSelection': {
      const text = readSelection(cmd.format);
      if (!text) {
        // §5.1 — the selection vanished between the click and the injection. Say so;
        // never write an empty file.
        showToast(t('selectionGone'), { tone: 'warn', theme });
        return { ok: true, kind: 'done' };
      }
      const name = safeFilename(
        `${location.hostname}-${document.title || t('filenamePageFallback')}`,
        cmd.format,
        prefs.filenameTranslit,
      );
      const res = saveTextParts([text], name, cmd.format === 'md' ? MIME.md! : MIME.txt!);
      if (res.ok) {
        showToast(t('saveStarted', { filename: res.filename }), {
          theme,
          actions: [
            {
              label: t('fileDidntAppear'),
              onClick: () => {
                void ask({
                  type: 'stashAndSave',
                  filename: name,
                  text,
                  mime: cmd.format === 'md' ? MIME.md! : MIME.txt!,
                });
              },
            },
          ],
        });
      } else {
        showToast(t('pageBlocksDownloads'), {
          tone: 'error',
          theme,
          actions: [
            {
              label: t('saveViaTab'),
              onClick: () => {
                void ask({
                  type: 'stashAndSave',
                  filename: name,
                  text,
                  mime: cmd.format === 'md' ? MIME.md! : MIME.txt!,
                });
              },
            },
          ],
        });
      }
      return { ok: true, kind: 'done' };
    }

    case 'copySelectionMarkdown': {
      const text = readSelection('md');
      if (!text) {
        showToast(t('selectionGone'), { tone: 'warn', theme });
        return { ok: true, kind: 'done' };
      }
      const ok = await copyText(text);
      if (ok) showToast(t('copiedMd'), { theme });
      else showManualCopy(text, theme, locale); // §5.6 — we never pretend the copy happened
      return { ok: true, kind: 'done' };
    }

    case 'copyImageUrl':
      await doCopyImageUrl(cmd.srcUrl, theme, locale);
      return { ok: true, kind: 'done' };

    case 'pickImage': {
      // MOBILE PARITY (Firefox for Android has no context menu at all): reach the
      // image actions through the on-page picker instead of a right-click.
      const imgs = Array.from(document.images).filter(
        (im) => im.naturalWidth >= 64 && im.naturalHeight >= 64 && isSafeAssetUrl(im.currentSrc || im.src),
      );
      if (imgs.length === 0) {
        showToast(t('noImagesFound'), {
          tone: 'warn',
          theme,
        });
        return { ok: true, kind: 'done' };
      }
      const candidates: Candidate[] = imgs.slice(0, 60).map((im, i) => ({
        id: `i${i}`,
        element: im,
        label: `${im.naturalWidth}×${im.naturalHeight}${im.alt ? ` · «${im.alt.slice(0, 40)}»` : ''}`,
        warnings: [],
      }));
      const got = await pickElements(candidates, { multi: false, theme, title: t('pickImageTitle'), locale });
      if (!got?.length) return { ok: true, kind: 'done' };
      const img = imgs[Number(got[0]!.slice(1))]!;
      showImageActions(img.currentSrc || img.src, prefs.filenameTranslit, theme, locale);
      return { ok: true, kind: 'done' };
    }

    case 'saveImage':
      // 🔴 BLOCKER #1 lives here — see `saveImage` in utils/file-writer.ts.
      await doSaveImage(cmd.srcUrl, prefs.filenameTranslit, theme, locale);
      return { ok: true, kind: 'done' };

    case 'exportTable':
    case 'exportAllTables': {
      const tables = scanTables(document);
      if (tables.length === 0) {
        // §5.2 — an honest dead end. Not a dialog, and not a lie about why.
        showToast(t('noTablesFound'), { tone: 'warn', theme });
        return { ok: true, kind: 'done' };
      }

      const models: TableModel[] = [];
      const elements = new Map<string, HTMLTableElement>();
      for (let i = 0; i < tables.length; i++) {
        const id = `t${i}`;
        elements.set(id, tables[i]!);
        models.push(await buildTableModel(tables[i]!, id, opts));
      }
      // Score sorts and warns; it never HIDES a table (design §4.2).
      models.sort((a, b) => Number(a.looksLikeLayout) - Number(b.looksLikeLayout));

      const multi = cmd.type === 'exportAllTables';
      let chosen: string[] | null;

      if (cmd.type === 'exportTable' && cmd.tableId && elements.has(cmd.tableId)) {
        chosen = [cmd.tableId]; // straight from the popup list
      } else if (!multi && models.length === 1) {
        chosen = [models[0]!.id]; // one table → skip the picker (design §4.2)
      } else {
        const candidates: Candidate[] = models.map((m) => {
          const warnings: string[] = [];
          if (m.hasMergedCells) warnings.push(t('warnMerged'));
          if (m.hasNestedTables) warnings.push(t('warnNested'));
          if (m.looksLikeLayout) warnings.push(t('warnLayout'));
          if (m.virtualized) warnings.push(t('warnVirtualized'));
          return {
            id: m.id,
            element: elements.get(m.id)!,
            label: `${t('tabTable')} · ${t('candTableLabel', { rows: m.rows, cols: m.cols })}${
              m.caption ? ` · «${m.caption}»` : ''
            }`,
            warnings,
          };
        });
        chosen = await pickElements(candidates, {
          multi,
          theme,
          title: multi ? t('pickTablesTitle') : t('pickTableTitle'),
          locale,
        });
      }
      if (!chosen?.length) return { ok: true, kind: 'done' };

      await openExportDialog(
        chosen.map((id) => ({
          model: models.find((m) => m.id === id)!,
          element: elements.get(id)!,
        })),
        { prefs, ask, extractOptions: opts, locale },
      );
      return { ok: true, kind: 'done' };
    }
  }
}

/* ================================================================== *
 * Image actions — shared by the context menu AND the popup/picker path
 * ================================================================== */

async function doCopyImageUrl(srcUrl: string, theme: OverlayTheme, locale: Locale): Promise<void> {
  if (!isSafeAssetUrl(srcUrl)) {
    showToast(tAt(locale, 'imgUrlUnsupported'), { tone: 'warn', theme });
    return;
  }
  // ⚠️ `srcUrl` is the `src` ATTRIBUTE; with `srcset` the browser may have loaded a
  // different file. Copying a URL that is not the one on screen would be a lie (§4.3).
  const { url, viaSrcset } = resolveCurrentSrc(srcUrl);
  const ok = await copyText(url);
  if (ok) {
    showToast(tAt(locale, viaSrcset ? 'copiedUrlSrcset' : 'copiedImgUrl'), { theme });
  } else {
    showManualCopy(url, theme, locale); // §5.6 — never pretend the copy happened
  }
}

async function doSaveImage(
  srcUrl: string,
  translit: boolean,
  theme: OverlayTheme,
  locale: Locale,
): Promise<void> {
  const { url } = resolveCurrentSrc(srcUrl);
  const outcome = await saveImage(url, ask, translit);
  if (outcome.result.ok) {
    showToast(tAt(locale, 'saveStarted', { filename: outcome.result.filename }), { theme });
    return;
  }
  if (outcome.result.reason === 'bad-url') {
    showToast(tAt(locale, 'imgUrlUnsupported'), { tone: 'warn', theme });
    return;
  }
  // 🔴 HONEST REFUSAL (design §5.9 / §7.3). We do NOT click an anchor pointing at a
  // cross-origin URL: the `download` attribute is ignored there and the browser
  // would NAVIGATE the user's page away instead of saving. That silent navigation
  // is the exact trap this ladder exists to avoid, so we stop and say why.
  showToast(
    tAt(locale, 'imgRefusal', { host: outcome.host ?? tAt(locale, 'otherSite') }),
    {
      tone: 'warn',
      theme,
      actions: [
        { label: tAt(locale, 'openImage'), onClick: () => void ask({ type: 'openTab', url }) },
        { label: tAt(locale, 'enablePermission'), onClick: () => void ask({ type: 'openOptions' }) },
      ],
    },
  );
}

/** The three image actions, reachable WITHOUT a context menu (mobile parity). */
function showImageActions(url: string, translit: boolean, theme: OverlayTheme, locale: Locale): void {
  const h = getHost(theme);
  h.ui.replaceChildren();
  const panel = el('div', 'bx-panel bx-panel--center');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.append(el('h2', 'bx-h', tAt(locale, 'imageWord')));
  panel.append(el('p', 'bx-sub', url));

  const foot = el('div', 'bx-foot');
  const mk = (label: string, fn: () => void, cls = 'bx-btn--ghost'): HTMLButtonElement => {
    const b = el('button', `bx-btn ${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };
  const first = mk(tAt(locale, 'copyUrl'), () => {
    destroyOverlay();
    void doCopyImageUrl(url, theme, locale);
  });
  first.setAttribute('data-autofocus', '');
  foot.append(first);
  foot.append(
    mk(tAt(locale, 'openInNewTab'), () => {
      destroyOverlay();
      void ask({ type: 'openTab', url });
    }),
  );
  foot.append(
    mk(tAt(locale, 'saveDots'), () => {
      destroyOverlay();
      void doSaveImage(url, translit, theme, locale);
    }, 'bx-btn--primary'),
  );
  foot.append(mk(tAt(locale, 'cancel'), () => destroyOverlay()));
  panel.append(foot);
  h.ui.append(panel);
  first.focus();
}

/** §5.6 — the clipboard refused. Give the user the text, selected, and say so. We
 *  do not claim a copy that did not happen. */
function showManualCopy(text: string, theme: OverlayTheme, locale: Locale): void {
  const h = getHost(theme);
  h.ui.replaceChildren();
  const panel = el('div', 'bx-panel bx-panel--center');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.append(el('h2', 'bx-h', tAt(locale, 'clipboardFailTitle')));
  panel.append(el('p', 'bx-sub', tAt(locale, 'clipboardFailBody')));
  const ta = el('textarea', 'bx-ta');
  ta.value = text; // .value, not innerHTML
  ta.readOnly = true;
  ta.setAttribute('data-autofocus', '');
  panel.append(ta);
  const foot = el('div', 'bx-foot');
  const close = el('button', 'bx-btn bx-btn--primary', tAt(locale, 'close'));
  close.type = 'button';
  close.addEventListener('click', () => destroyOverlay());
  foot.append(close);
  panel.append(foot);
  h.ui.append(panel);
  ta.focus();
  ta.select();
}
