import { browser } from 'wxt/browser';

// Putting the viewer on someone else's page — the only part of this extension
// that touches a page at all (design §4.3, §8).
//
// Two paths, and the difference is the whole permission story:
//
//   A. ONE-SHOT ("Format JSON on this tab"). The toolbar click grants
//      `activeTab` — the host, for this tab, for this moment. On Chrome MV3 we
//      additionally need the `scripting` PERMISSION (not a host permission) to
//      be allowed to call `scripting.executeScript`; it is optional and
//      requested on the click, and because no host is asked for, Chrome shows no
//      "read your data on all sites" warning. On Firefox MV2 `tabs.executeScript`
//      works straight from `activeTab` and no extra permission is involved.
//
//   B. AUTO (opt-in). Requires `<all_urls>`, requested only from behind the
//      consent dialog, and registers the same script at document_start.
//      Revoking the grant unregisters it (`permissions.onRemoved`), so the UI
//      can never show "on" while the feature is dead.
//
// The injected file is `content-scripts/formatter.js`, built from
// entrypoints/formatter.content.ts with `registration: 'runtime'` — i.e. it is
// deliberately ABSENT from the manifest.

export const FORMATTER_FILE = 'content-scripts/formatter.js';
export const AUTOFORMAT_ID = 'devdata-autoformat';

export type FormatPageResult =
  | { status: 'formatted' }
  | { status: 'not-json'; contentType: string }
  | { status: 'restricted' }
  | { status: 'denied' }
  | { status: 'error'; message: string };

interface ScriptingApi {
  executeScript: (args: {
    target: { tabId: number };
    files: string[];
  }) => Promise<unknown>;
  registerContentScripts: (scripts: unknown[]) => Promise<void>;
  unregisterContentScripts: (filter: { ids: string[] }) => Promise<void>;
  getRegisteredContentScripts: (filter?: { ids: string[] }) => Promise<unknown[]>;
}

function scripting(): ScriptingApi | null {
  const api = (browser as unknown as { scripting?: ScriptingApi }).scripting;
  return api ?? null;
}

/** Firefox MV2 fallback (`tabs.executeScript` + `contentScripts.register`). */
interface Mv2Api {
  tabs?: { executeScript?: (tabId: number, details: { file: string }) => Promise<unknown> };
  contentScripts?: {
    register: (options: unknown) => Promise<{ unregister: () => void }>;
  };
}

let mv2Registration: { unregister: () => void } | null = null;

async function inject(tabId: number): Promise<void> {
  const api = scripting();
  if (api) {
    await api.executeScript({ target: { tabId }, files: [FORMATTER_FILE] });
    return;
  }
  const mv2 = browser as unknown as Mv2Api;
  if (mv2.tabs?.executeScript) {
    await mv2.tabs.executeScript(tabId, { file: `/${FORMATTER_FILE}` });
    return;
  }
  throw new Error('Ни scripting.executeScript, ни tabs.executeScript недоступны.');
}

/** Run the one-shot in-page formatter on `tabId`. */
export async function formatActiveTab(tabId: number): Promise<FormatPageResult> {
  try {
    // Already there? Re-injecting would stack message listeners.
    let present = false;
    try {
      const pong = (await browser.tabs.sendMessage(tabId, {
        type: 'devdata:ping',
      })) as { ok?: boolean } | undefined;
      present = pong?.ok === true;
    } catch {
      present = false;
    }

    if (!present) await inject(tabId);

    const reply = (await browser.tabs.sendMessage(tabId, {
      type: 'devdata:format',
    })) as { status?: string; contentType?: string } | undefined;

    if (reply?.status === 'formatted') return { status: 'formatted' };
    if (reply?.status === 'not-json') {
      return { status: 'not-json', contentType: reply.contentType ?? 'неизвестен' };
    }
    return {
      status: 'error',
      message: 'Скрипт на странице не ответил. Перезагрузите вкладку и попробуйте снова.',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // chrome://, about:, the Web Store — injection is physically impossible, and
    // that is a browser rule, not an error of ours (design §4.3).
    if (/cannot access|Missing host permission|Extension manifest|about:|chrome:\/\//i.test(message)) {
      return { status: 'restricted' };
    }
    return { status: 'error', message };
  }
}

/* ------------------------------ auto-format ------------------------------- */

/** Register the opt-in auto-formatter. Idempotent; safe to call on every mount. */
export async function registerAutoFormat(): Promise<void> {
  const api = scripting();
  if (api) {
    try {
      const existing = await api.getRegisteredContentScripts({ ids: [AUTOFORMAT_ID] });
      if (existing.length > 0) return;
    } catch {
      // Some engines throw instead of returning [] — fall through to register.
    }
    await api.registerContentScripts([
      {
        id: AUTOFORMAT_ID,
        matches: ['<all_urls>'],
        js: [FORMATTER_FILE],
        runAt: 'document_start',
        persistAcrossSessions: true,
      },
    ]);
    return;
  }

  const mv2 = browser as unknown as Mv2Api;
  if (mv2.contentScripts?.register) {
    if (mv2Registration) return;
    mv2Registration = await mv2.contentScripts.register({
      matches: ['<all_urls>'],
      js: [{ file: `/${FORMATTER_FILE}` }],
      runAt: 'document_start',
    });
    return;
  }
  throw new Error('Регистрация контент-скриптов недоступна в этом браузере.');
}

/** Unregister — called when the grant is revoked, from anywhere (design §8). */
export async function unregisterAutoFormat(): Promise<void> {
  const api = scripting();
  if (api) {
    try {
      await api.unregisterContentScripts({ ids: [AUTOFORMAT_ID] });
    } catch {
      // Not registered — nothing to undo.
    }
    return;
  }
  if (mv2Registration) {
    try {
      mv2Registration.unregister();
    } catch {
      /* already gone */
    }
    mv2Registration = null;
  }
}
