import { browser } from '#imports';
import {
  dedupeSession,
  defaultSessionName,
  isRestorableUrl,
  newSessionId,
  type SavedGroup,
  type SavedSession,
  type SavedTab,
  type SavedWindow,
} from './model';
import { tabGroupsSupported } from './permissions';

// Capture (PLAN.md §14 SCOPE). Reads open tabs/windows via `tabs.query` +
// `windows.getAll` — the exact use the unavoidable `tabs` permission exists for.
// 🔴 Only URL/title/favicon/position/pinned are read; never page content. Group
// name/colour is read opportunistically IF the optional `tabGroups` is present
// (feature-detected), and is simply omitted otherwise — capture never fails because
// an optional API is missing.

// Minimal structural shapes for what we read. The generated `browser.*` types use
// MV2 callback overloads, so `ReturnType`/`Awaited` on them resolves to `void`;
// declaring exactly the fields we touch is both cleaner and version-proof.
interface Tab {
  url?: string;
  title?: string;
  favIconUrl?: string;
  pinned?: boolean;
  active?: boolean;
  groupId?: number;
  cookieStoreId?: string;
}
interface Window {
  id?: number;
  incognito?: boolean;
  state?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  tabs?: Tab[];
}

function toSavedTab(tab: Tab, index: number): SavedTab | null {
  const url = tab.url ?? '';
  if (!isRestorableUrl(url)) return null; // skip about:blank/blank/unreadable tabs
  const saved: SavedTab = {
    url,
    title: tab.title ?? url,
    pinned: tab.pinned ?? false,
    active: tab.active ?? false,
    index,
  };
  if (tab.favIconUrl && /^https?:\/\//i.test(tab.favIconUrl)) saved.favIconUrl = tab.favIconUrl;
  const groupId = (tab as { groupId?: number }).groupId;
  if (typeof groupId === 'number' && groupId >= 0) saved.groupId = groupId;
  const cookieStoreId = (tab as { cookieStoreId?: string }).cookieStoreId;
  if (cookieStoreId && cookieStoreId !== 'firefox-default') saved.cookieStoreId = cookieStoreId;
  return saved;
}

async function captureGroups(windowId: number, tabs: SavedTab[]): Promise<SavedGroup[] | undefined> {
  if (!tabGroupsSupported()) return undefined;
  const ids = [...new Set(tabs.map((t) => t.groupId).filter((g): g is number => g !== undefined))];
  if (ids.length === 0) return undefined;
  const groups: SavedGroup[] = [];
  for (const groupId of ids) {
    try {
      const g = await browser.tabGroups.get(groupId);
      groups.push({
        groupId,
        title: g.title || undefined,
        color: g.color,
        collapsed: g.collapsed,
      });
    } catch {
      // Group vanished mid-capture, or FF version without full support — skip it,
      // the tabs still restore ungrouped.
    }
  }
  return groups.length ? groups : undefined;
}

async function toSavedWindow(win: Window): Promise<SavedWindow | null> {
  const rawTabs = win.tabs ?? [];
  const tabs: SavedTab[] = [];
  rawTabs.forEach((tab) => {
    const saved = toSavedTab(tab, tabs.length);
    if (saved) tabs.push(saved);
  });
  if (tabs.length === 0) return null;
  const saved: SavedWindow = { incognito: win.incognito ?? false, tabs };
  if (typeof win.state === 'string') saved.state = win.state;
  if (typeof win.left === 'number') saved.left = win.left;
  if (typeof win.top === 'number') saved.top = win.top;
  if (typeof win.width === 'number') saved.width = win.width;
  if (typeof win.height === 'number') saved.height = win.height;
  const groups = await captureGroups(win.id ?? -1, tabs);
  if (groups) saved.groups = groups;
  return saved;
}

function finalize(windows: SavedWindow[], name: string | undefined, dedupe: boolean): SavedSession {
  const now = Date.now();
  const session: SavedSession = {
    id: newSessionId(),
    name: name ?? defaultSessionName(now),
    createdAt: now,
    updatedAt: now,
    kind: 'manual',
    windows,
  };
  return dedupe ? dedupeSession(session) : session;
}

/** Capture the current (focused) window as an unsaved session. */
export async function captureCurrentWindow(
  opts: { name?: string; dedupe?: boolean } = {},
): Promise<SavedSession | null> {
  const win = (await browser.windows.getCurrent({ populate: true })) as Window;
  const saved = await toSavedWindow(win);
  return saved ? finalize([saved], opts.name, opts.dedupe ?? true) : null;
}

/** Capture every normal browser window as one multi-window session. */
export async function captureAllWindows(
  opts: { name?: string; dedupe?: boolean } = {},
): Promise<SavedSession | null> {
  const wins = (await browser.windows.getAll({ populate: true, windowTypes: ['normal'] })) as Window[];
  const saved: SavedWindow[] = [];
  for (const win of wins) {
    const w = await toSavedWindow(win);
    if (w) saved.push(w);
  }
  return saved.length ? finalize(saved, opts.name, opts.dedupe ?? true) : null;
}

/** Build the rolling autosave snapshot used by the background heartbeat — the live
 *  set of all normal windows, tagged as an autosave. Returns null when there is
 *  nothing worth saving (so we never overwrite a good autosave with an empty one). */
export async function captureLiveSnapshot(): Promise<SavedSession | null> {
  const session = await captureAllWindows({ dedupe: false });
  if (!session) return null;
  return { ...session, id: 'autosave', kind: 'autosave' };
}
