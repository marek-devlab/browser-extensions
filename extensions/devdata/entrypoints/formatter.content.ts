import { defineContentScript } from '#imports';
import { browser } from 'wxt/browser';

// The in-page JSON viewer (design §2.12, §4.3).
//
// ⚠️ `registration: 'runtime'` is load-bearing: it keeps this script OUT of the
// manifest, so the extension asks for NO host permission at install time. It is
// only ever put on a page:
//   - one-shot, via `scripting.executeScript` on the tab the user just clicked
//     the toolbar on (`activeTab` grants the host for that tab, for that moment),
//   - or, if the user explicitly opts in and grants `<all_urls>`, registered at
//     document_start by utils/format-page.ts.
//
// SECURITY: this runs on an untrusted page and renders untrusted text. Every
// node here is built with `document.createElement` + `textContent`. There is not
// one `innerHTML` in this file, and there must never be — a JSON document is
// attacker-controlled text (design §7.3).
//
// HONESTY: the viewer always announces itself ("Отформатировано расширением")
// and always offers ✕, which restores the ORIGINAL text we kept in a variable —
// we never try to re-derive the page (design §2.12, §6.13).

const JSON_TYPES = /^(application\/(json|.*\+json)|text\/json)$/i;

/** Above this we do not build a tree — a 20 MB in-page tree would hang the page. */
const MAX_TREE_BYTES = 4_000_000;

/**
 * Cap for the AUTO sniff of a `text/plain` body (below). This runs a synchronous
 * JSON.parse on the HOST page's main thread at DOMContentLoaded, so it must stay
 * cheap: auto-format is a convenience for small JSON responses, not a heavy-doc
 * path. A big document is served with a real JSON content-type far more often
 * than as text/plain, and for those we take the fast type-check path anyway; the
 * explicit toolbar action (activeTab) still handles large text/plain bodies on
 * demand. So keep this well below MAX_TREE_BYTES — a few hundred KB is plenty. */
const MAX_SNIFF_BYTES = 512_000;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  // Not in the manifest. Registered at runtime, only with the user's grant.
  registration: 'runtime',

  main() {
    const w = window as Window & { __devdataFormatter?: boolean };
    if (w.__devdataFormatter) return;
    w.__devdataFormatter = true;

    let original: string | null = null;
    let host: HTMLElement | null = null;

    const contentType = (document.contentType || '').toLowerCase();

    const isJsonPage = (maxSniffBytes: number): boolean => {
      if (JSON_TYPES.test(contentType)) return true;
      // A .json served as text/plain is extremely common. Only claim it when the
      // body really parses — never guess from the URL alone.
      if (contentType === 'text/plain') {
        const text = document.body?.textContent ?? '';
        // The sniff parses synchronously on the host page's main thread, so the
        // cap depends on WHO asked: MAX_SNIFF_BYTES for the unprompted auto path,
        // the full budget for the explicit toolbar action the user just clicked.
        if (text.length === 0 || text.length > maxSniffBytes) return false;
        try {
          JSON.parse(text);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    };

    const render = (
      maxSniffBytes: number,
    ): { status: 'formatted' | 'not-json'; contentType: string } => {
      if (host) return { status: 'formatted', contentType };
      if (!isJsonPage(maxSniffBytes))
        return { status: 'not-json', contentType: contentType || 'неизвестен' };

      const body = document.body;
      if (!body) return { status: 'not-json', contentType };
      const text = body.textContent ?? '';
      original = text;

      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return { status: 'not-json', contentType };
      }

      host = buildViewer(text, value, () => restore());
      // Replace, don't append: the raw JSON dump underneath would just be noise.
      body.replaceChildren(host);
      return { status: 'formatted', contentType };
    };

    const restore = (): void => {
      if (original === null || !document.body) return;
      const pre = document.createElement('pre');
      pre.textContent = original; // textContent: never innerHTML
      document.body.replaceChildren(pre);
      host = null;
    };

    // The popup asks; the content script answers. (`executeScript({files})`
    // cannot return a value reliably, so status travels by message.)
    browser.runtime.onMessage.addListener((message: unknown) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === 'devdata:ping') return Promise.resolve({ ok: true });
      // Explicit action (activeTab): the user asked, so a main-thread parse of a
      // large text/plain body is acceptable — use the full budget, not the sniff cap.
      if (type === 'devdata:format') return Promise.resolve(render(20_000_000));
      return undefined;
    });

    // Auto-format path (opt-in, `<all_urls>` granted): render as soon as there
    // is a body to read. At document_start there is not one yet.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => void autoRender(), {
        once: true,
      });
    } else {
      void autoRender();
    }

    async function autoRender(): Promise<void> {
      // Only the registered (auto) injection should render unprompted; the
      // one-shot injection waits for the explicit `devdata:format` message.
      // We distinguish them by asking the background whether auto-format is on
      // — cheap, and it keeps the one-shot from surprising the user.
      try {
        const reply = (await browser.runtime.sendMessage({
          type: 'devdata:auto?',
        })) as { auto?: boolean } | undefined;
        if (reply?.auto === true) render(MAX_SNIFF_BYTES);
      } catch {
        // Background asleep / message channel closed: do nothing. A viewer that
        // fails to appear is a non-event; a viewer that appears unasked is not.
      }
    }
  },
});

/* ------------------------------ the viewer -------------------------------- */

function buildViewer(raw: string, value: unknown, onClose: () => void): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-devdata-viewer', '');
  root.style.cssText = [
    'all: initial',
    'display: block',
    'font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace',
    'color: #202124',
    'background: #ffffff',
    'padding: 0',
  ].join(';');

  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    root.style.color = '#e8eaed';
    root.style.background = '#202124';
  }

  const bar = document.createElement('div');
  bar.style.cssText = [
    'display: flex',
    'gap: 8px',
    'align-items: center',
    'flex-wrap: wrap',
    'padding: 8px 12px',
    'border-bottom: 1px solid rgba(128,128,128,.4)',
    'position: sticky',
    'top: 0',
    'background: inherit',
    'font-family: system-ui, sans-serif',
  ].join(';');

  const label = document.createElement('strong');
  label.textContent = '▣ Отформатировано расширением';
  bar.appendChild(label);

  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  bar.appendChild(spacer);

  const treePane = document.createElement('div');
  const rawPane = document.createElement('pre');
  rawPane.textContent = raw;
  rawPane.style.cssText = 'margin:0;padding:12px;white-space:pre-wrap;word-break:break-word';
  rawPane.hidden = true;

  const treeBtn = button('Дерево', () => {
    treePane.hidden = false;
    rawPane.hidden = true;
  });
  const rawBtn = button('Сырой текст', () => {
    treePane.hidden = true;
    rawPane.hidden = false;
  });
  const openBtn = button('Открыть в инструменте', () => {
    browser.runtime
      .sendMessage({ type: 'openTool', route: 'data' })
      .catch(() => undefined);
  });
  const closeBtn = button('✕ Вернуть документ', onClose);
  for (const b of [treeBtn, rawBtn, openBtn, closeBtn]) bar.appendChild(b);

  treePane.style.cssText = 'padding: 8px 12px';
  if (raw.length > MAX_TREE_BYTES) {
    const note = document.createElement('p');
    note.textContent = `Документ ${Math.round(raw.length / 1_000_000)} МБ — дерево на самой странице не строится (это подвесило бы вкладку). Показан сырой текст; полноценное дерево — в инструменте.`;
    note.style.cssText = 'font-family: system-ui, sans-serif; font-size: 12px';
    treePane.appendChild(note);
    treePane.hidden = true;
    rawPane.hidden = false;
  } else {
    treePane.appendChild(buildTree(value));
  }

  root.appendChild(bar);
  root.appendChild(treePane);
  root.appendChild(rawPane);
  return root;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  // ≥44px tall on touch (Firefox for Android is a target platform, design §9.3).
  b.style.cssText = [
    'font: 13px system-ui, sans-serif',
    'padding: 10px 12px',
    'min-height: 44px',
    'border: 1px solid rgba(128,128,128,.5)',
    'border-radius: 4px',
    'background: transparent',
    'color: inherit',
    'cursor: pointer',
  ].join(';');
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Build the tree with native <details>/<summary>: collapse for free, zero JS,
 * keyboard-operable by construction. Iterative — a deep document must not blow
 * the stack of the page we are a guest on.
 */
function buildTree(value: unknown): HTMLElement {
  const root = document.createElement('div');
  type Frame = { value: unknown; key: string | null; parent: HTMLElement; depth: number };
  const stack: Frame[] = [{ value, key: null, parent: root, depth: 0 }];

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    const isArray = Array.isArray(frame.value);
    const isObject = !isArray && frame.value !== null && typeof frame.value === 'object';

    if ((isArray || isObject) && frame.depth < 100) {
      const entries: [string, unknown][] = isArray
        ? (frame.value as unknown[]).map((v, i) => [String(i), v])
        : Object.entries(frame.value as Record<string, unknown>);

      const details = document.createElement('details');
      details.open = frame.depth < 2;
      details.style.marginLeft = frame.depth === 0 ? '0' : '14px';
      const summary = document.createElement('summary');
      summary.style.cssText = 'cursor: pointer; padding: 3px 0; min-height: 22px';
      summary.textContent = `${frame.key === null ? '' : `${frame.key}  `}${
        isArray ? '[]' : '{}'
      } ${entries.length}`;
      details.appendChild(summary);
      frame.parent.appendChild(details);

      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i];
        if (!entry) continue;
        stack.push({
          value: entry[1],
          key: entry[0],
          parent: details,
          depth: frame.depth + 1,
        });
      }
      continue;
    }

    const row = document.createElement('div');
    row.style.marginLeft = '14px';
    row.style.padding = '2px 0';
    // textContent, always. This string comes from an untrusted document.
    row.textContent = `${frame.key === null ? '' : `${frame.key}: `}${preview(frame.value)}`;
    frame.parent.appendChild(row);
  }

  return root;
}

function preview(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'object') return '…';
  return String(v);
}
