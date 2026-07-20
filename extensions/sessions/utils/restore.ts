import { browser } from '#imports';
import type { SavedGroup, SavedSession, SavedTab, SavedWindow } from './model';
import { requestPermission, tabGroupsSupported } from './permissions';

// Restore (PLAN.md §14.3). Two hard cross-browser problems are handled here:
//
//  1. NO RESOURCE SPIKE. A 200-tab session must not load 200 pages at once. Tabs
//     are restored UNLOADED:
//       • Firefox has `tabs.create({ discarded:true, title, url })` — used directly.
//       • ⚠️ Chrome's `tabs.create` has NO `discarded`. So we create a bundled
//         SUSPENDED PLACEHOLDER (`/suspended.html#…`) that shows the title+favicon
//         and only navigates to the real URL when the tab is first shown → zero
//         network until the user actually clicks the tab.
//
//  2. THE CHROMIUM MASS-RESTORE DEADLOCK. Creating many tabs at once has been known
//     to wedge the Chromium UI thread, so creation is THROTTLED to `BATCH` at a time.
//
// Everything degrades safely: a tab that fails to create is counted and skipped, a
// missing optional API (tabGroups / containers) is simply not used.

const BATCH = 5;

export type RestoreMode = 'newWindow' | 'current';

export interface RestoreOptions {
  mode: RestoreMode;
  lazy: boolean;
  restoreGroups: boolean;
}

export interface RestoreResult {
  windowsRestored: number;
  tabsRestored: number;
  tabsFailed: number;
  groupsRestored: number;
}

// tabs.create props, widened with the Firefox-only fields Chrome's typings omit.
type CreateProps = Parameters<typeof browser.tabs.create>[0] & {
  discarded?: boolean;
  title?: string;
  cookieStoreId?: string;
};

/** The bundled placeholder URL carrying the real target in its hash (Chrome lazy). */
function placeholderUrl(tab: SavedTab): string {
  const params = new URLSearchParams();
  params.set('u', tab.url);
  if (tab.title) params.set('t', tab.title);
  if (tab.favIconUrl) params.set('i', tab.favIconUrl);
  return `${browser.runtime.getURL('/suspended.html')}#${params.toString()}`;
}

function createPropsFor(tab: SavedTab, windowId: number, lazy: boolean): CreateProps {
  const base: CreateProps = {
    windowId,
    index: tab.index,
    pinned: tab.pinned,
    active: false, // never steal focus mid-restore; the active tab is set at the end
  };
  // Firefox containers: only meaningful on Firefox and only if we hold `cookies`.
  if (import.meta.env.FIREFOX && tab.cookieStoreId) base.cookieStoreId = tab.cookieStoreId;

  if (!lazy) {
    base.url = tab.url;
    return base;
  }
  if (import.meta.env.FIREFOX) {
    // Native lazy: a discarded tab shows title+favicon and loads on activation.
    base.url = tab.url;
    base.discarded = true;
    base.title = tab.title || tab.url;
    return base;
  }
  // Chrome: no `discarded` on create → our own suspended placeholder page.
  base.url = placeholderUrl(tab);
  return base;
}

async function createTab(
  tab: SavedTab,
  windowId: number,
  lazy: boolean,
): Promise<{ id: number; groupId?: number } | null> {
  try {
    const created = await browser.tabs.create(createPropsFor(tab, windowId, lazy));
    return created.id != null ? { id: created.id, groupId: tab.groupId } : null;
  } catch {
    // A restricted URL (some chrome://), a container that no longer exists, etc.
    return null;
  }
}

/** Re-create the tab groups: cluster the freshly-created tab ids by their original
 *  groupId, group them, then restore name/colour/collapsed. Optional and fully
 *  guarded — on any failure the tabs simply stay ungrouped. */
async function restoreGroups(
  windowId: number,
  created: { id: number; groupId?: number }[],
  savedGroups: SavedGroup[] | undefined,
): Promise<number> {
  if (!tabGroupsSupported()) return 0;
  const byGroup = new Map<number, number[]>();
  for (const c of created) {
    if (c.groupId === undefined) continue;
    const arr = byGroup.get(c.groupId) ?? [];
    arr.push(c.id);
    byGroup.set(c.groupId, arr);
  }
  let restored = 0;
  for (const [origId, tabIds] of byGroup) {
    if (tabIds.length === 0) continue;
    try {
      // The generated types want a non-empty tuple for `tabIds`; we guarded length
      // above. `group` carries an MV2 callback overload, so the promise result is
      // narrowed with an explicit cast.
      const newGroupId = (await browser.tabs.group({
        tabIds: tabIds as [number, ...number[]],
        createProperties: { windowId },
      })) as number;
      const meta = savedGroups?.find((g) => g.groupId === origId);
      if (meta) {
        try {
          // ⚠️ Firefox exposes tabGroups.update only from FF139 — hence the inner
          // try: grouping still succeeds, only the name/colour may not apply.
          await browser.tabGroups.update(newGroupId, {
            title: meta.title,
            color: meta.color as never,
            collapsed: meta.collapsed,
          });
        } catch {
          /* older Firefox: leave the group with its default name/colour */
        }
      }
      restored++;
    } catch {
      /* grouping unavailable on this build — tabs remain ungrouped */
    }
  }
  return restored;
}

async function restoreWindow(
  win: SavedWindow,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  let windowId: number;

  if (opts.mode === 'newWindow') {
    // Open the window on its first tab. For a lazy restore we point the first tab at
    // the placeholder so even the new window opens with nothing loaded.
    const first = win.tabs[0];
    const createData: Parameters<typeof browser.windows.create>[0] = {
      url: opts.lazy && !import.meta.env.FIREFOX ? placeholderUrl(first) : first.url,
      focused: false,
    };
    // Bounds only apply to a 'normal' window; a maximized/fullscreen one ignores them.
    if (!win.state || win.state === 'normal') {
      if (typeof win.left === 'number') createData.left = win.left;
      if (typeof win.top === 'number') createData.top = win.top;
      if (typeof win.width === 'number') createData.width = win.width;
      if (typeof win.height === 'number') createData.height = win.height;
    } else {
      createData.state = win.state as never;
    }
    let created;
    try {
      created = await browser.windows.create(createData);
    } catch {
      // Could not open the window at all — count every tab as failed and move on.
      result.tabsFailed += win.tabs.length;
      return;
    }
    windowId = created?.id ?? -1;
    result.windowsRestored++;
    const firstTab = created?.tabs?.[0];
    const firstCreated: { id: number; groupId?: number }[] =
      firstTab?.id != null ? [{ id: firstTab.id, groupId: first.groupId }] : [];
    result.tabsRestored += firstCreated.length;
    const rest = await createTabsThrottled(win.tabs.slice(1), windowId, opts, result);
    if (opts.restoreGroups) {
      result.groupsRestored += await restoreGroups(windowId, [...firstCreated, ...rest], win.groups);
    }
    return;
  }

  // Merge into the current window.
  const current = await browser.windows.getCurrent();
  windowId = current.id ?? -1;
  result.windowsRestored++;
  const created = await createTabsThrottled(win.tabs, windowId, opts, result);
  if (opts.restoreGroups) {
    result.groupsRestored += await restoreGroups(windowId, created, win.groups);
  }
}

async function createTabsThrottled(
  tabs: SavedTab[],
  windowId: number,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<{ id: number; groupId?: number }[]> {
  const out: { id: number; groupId?: number }[] = [];
  for (let i = 0; i < tabs.length; i += BATCH) {
    const slice = tabs.slice(i, i + BATCH);
    const settled = await Promise.all(slice.map((t) => createTab(t, windowId, opts.lazy)));
    for (const c of settled) {
      if (c) {
        out.push(c);
        result.tabsRestored++;
      } else {
        result.tabsFailed++;
      }
    }
  }
  return out;
}

/**
 * Restore a whole session. If `restoreGroups` is asked for on Chrome and the
 * optional `tabGroups` permission is not yet held, it is requested here — this runs
 * from the restore click, which is a valid user gesture.
 */
export async function restoreSession(
  session: SavedSession,
  opts: RestoreOptions,
): Promise<RestoreResult> {
  const result: RestoreResult = {
    windowsRestored: 0,
    tabsRestored: 0,
    tabsFailed: 0,
    groupsRestored: 0,
  };

  const wantGroups =
    opts.restoreGroups && session.windows.some((w) => (w.groups?.length ?? 0) > 0);
  const effectiveGroups = wantGroups ? await requestPermission('tabGroups') : false;
  const effective: RestoreOptions = { ...opts, restoreGroups: effectiveGroups };

  for (const win of session.windows) {
    await restoreWindow(win, effective, result);
  }
  return result;
}
