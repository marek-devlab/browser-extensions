// Runtime registration of the page engine's two content scripts (design §7.3,
// plan docs/plans/netblock/02-page.md §1). The scripts are NOT in the manifest;
// they exist in a tab only when the user granted host access to its origin
// ("Enable on this site" → `permissions.request` in the popup).
//
// Browser access goes through `globalThis.chrome`/`browser` read LAZILY: this
// module is imported by utils/engines/page.ts, which utils/engines/index.ts
// pulls into the Node logic tests — a top-level `#imports` would break them,
// and a top-level `chrome.*` would throw. Nothing here runs outside Chrome:
// `createEngines('firefox')` never constructs the page engine.

export const RELAY_SCRIPT_ID = 'netblock-relay';
export const PAGE_SCRIPT_ID = 'netblock-page';

/** Output paths WXT produces for the two `registration: 'runtime'` entrypoints. */
const RELAY_JS = 'content-scripts/relay.js';
const PAGE_JS = 'content-scripts/netblock-page.js';

interface RegisteredScript {
  id: string;
  js?: string[];
  matches?: string[];
  runAt?: 'document_start' | 'document_end' | 'document_idle';
  allFrames?: boolean;
  persistAcrossSessions?: boolean;
  world?: 'ISOLATED' | 'MAIN';
  matchOriginAsFallback?: boolean;
}

/** Structural subset of `chrome.scripting` / `chrome.permissions` we touch. */
export interface RegistrationApi {
  scripting?: {
    getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<RegisteredScript[]>;
    registerContentScripts(scripts: RegisteredScript[]): Promise<void>;
    updateContentScripts(scripts: RegisteredScript[]): Promise<void>;
    unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
  };
  permissions?: {
    getAll(): Promise<{ origins?: string[]; permissions?: string[] }>;
  };
}

export function browserApi(): RegistrationApi | undefined {
  const g = globalThis as { chrome?: RegistrationApi; browser?: RegistrationApi };
  return g.chrome?.scripting ? g.chrome : g.browser?.scripting ? g.browser : undefined;
}

/**
 * Origins the scripts may be registered for. `permissions.getAll().origins`
 * holds match patterns (`https://example.com/*`, `*://*.example.com/*`, and
 * possibly `<all_urls>` if the user granted "all sites"). Anything that is
 * not http(s) is dropped: `file://` needs a separate toggle and would make
 * `registerContentScripts` reject the whole call.
 */
export function injectableOrigins(origins: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  for (const o of origins ?? []) {
    if (o === '<all_urls>' || /^(https?|\*):\/\//.test(o)) out.add(o);
  }
  return [...out].sort();
}

function sameSet(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (!a || a.length !== b.length) return false;
  const sa = [...a].sort();
  return sa.every((v, i) => v === b[i]);
}

function scriptsFor(matches: string[], withFallback: boolean): RegisteredScript[] {
  const common = {
    matches,
    runAt: 'document_start' as const,
    allFrames: true,
    persistAcrossSessions: true,
    ...(withFallback ? { matchOriginAsFallback: true } : {}),
  };
  // Relay FIRST: it mints the nonce the MAIN script reads.
  return [
    { id: RELAY_SCRIPT_ID, js: [RELAY_JS], world: 'ISOLATED', ...common },
    { id: PAGE_SCRIPT_ID, js: [PAGE_JS], world: 'MAIN', ...common },
  ];
}

export interface ReconcileResult {
  /** What is registered now (empty = nothing). */
  matches: string[];
  changed: boolean;
}

/**
 * Make the registration match reality: `enabled` (page engine allowed) and
 * the granted origins. Idempotent; never throws — the caller reports
 * `error` events. Called on startup, on every `apply()`, on
 * `permissions.onAdded/onRemoved` and on `siteAccessChanged`.
 */
export async function reconcileRegistration(api: RegistrationApi, enabled: boolean): Promise<ReconcileResult> {
  const scripting = api.scripting;
  if (!scripting) return { matches: [], changed: false };
  const granted = enabled ? injectableOrigins((await api.permissions?.getAll())?.origins) : [];
  const registered = await scripting.getRegisteredContentScripts({ ids: [RELAY_SCRIPT_ID, PAGE_SCRIPT_ID] });
  const relay = registered.find((s) => s.id === RELAY_SCRIPT_ID);
  const page = registered.find((s) => s.id === PAGE_SCRIPT_ID);

  if (granted.length === 0) {
    if (!relay && !page) return { matches: [], changed: false };
    await scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
    return { matches: [], changed: true };
  }

  if (relay && page) {
    if (sameSet(relay.matches, granted) && sameSet(page.matches, granted)) return { matches: granted, changed: false };
    await scripting.updateContentScripts([
      { id: RELAY_SCRIPT_ID, matches: granted },
      { id: PAGE_SCRIPT_ID, matches: granted },
    ]);
    return { matches: granted, changed: true };
  }

  // Half-registered (a previous run died mid-way) → start clean.
  if (relay || page) await scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
  try {
    await scripting.registerContentScripts(scriptsFor(granted, true));
  } catch (err) {
    // `matchOriginAsFallback` is Chrome 119+; an older browser rejects the
    // unknown key — register without it rather than not at all.
    if (!/matchOriginAsFallback/i.test(String((err as Error)?.message ?? err))) throw err;
    await scripting.registerContentScripts(scriptsFor(granted, false));
  }
  return { matches: granted, changed: true };
}

/** `dispose()`: remove both scripts if present. Never throws. */
export async function unregisterAll(api: RegistrationApi): Promise<void> {
  const scripting = api.scripting;
  if (!scripting) return;
  try {
    const registered = await scripting.getRegisteredContentScripts({ ids: [RELAY_SCRIPT_ID, PAGE_SCRIPT_ID] });
    if (registered.length) await scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
  } catch {
    // Nothing registered, or the API is gone — either way there is nothing to undo.
  }
}
