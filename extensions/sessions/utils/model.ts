// Session Saver — the on-disk data MODEL and its validators (PLAN.md §14.4).
//
// The whole product lives or dies on this file being paranoid. Session Buddy v4's
// 2025 migration lost years of sessions; OneTab's reinstall wipes data. The lesson
// baked in here: NEVER trust what is in storage.local (it can be corrupt, half-
// written, hand-edited, or from an older build) and NEVER let a single bad record
// take the rest down. So every read goes through `normalizeSession` /
// `isValidSession`, an unreadable session is quarantined rather than deleted, and
// nothing here throws on bad input — it returns a safe fallback.
//
// 🔴 This is pure data + validation: no `browser.*`, no storage, no React. That is
// what lets the background SW, the popup and the manager all share one source of
// truth for "what a session is".

/** One saved tab. Only URL/title/favicon/position — nothing about page content. */
export interface SavedTab {
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
  /** Position within its window, so restore preserves order. */
  index: number;
  /** Original tab-group id (Chrome/FF139+). Resolved to a SavedGroup on restore. */
  groupId?: number;
  /** Firefox container (`cookieStoreId`). Ignored on Chrome. */
  cookieStoreId?: string;
}

/** A captured tab group (name + colour), restored via the optional `tabGroups`. */
export interface SavedGroup {
  /** The original groupId, used to re-associate SavedTabs on restore. */
  groupId: number;
  title?: string;
  color?: string;
  collapsed?: boolean;
}

/** One captured window: its bounds, its tabs, and any groups it held. */
export interface SavedWindow {
  incognito: boolean;
  state?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  tabs: SavedTab[];
  groups?: SavedGroup[];
}

export type SessionKind = 'manual' | 'autosave';

/** A full saved session — the value stored under a `sess:<id>` key. */
export interface SavedSession {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  kind: SessionKind;
  windows: SavedWindow[];
}

/** The lightweight summary held in the `idx` pointer — enough to render the list
 *  WITHOUT reading every session key (design §14.4: don't rewrite all sessions on
 *  each save). Counts and byte-size are precomputed here. */
export interface SessionMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  kind: SessionKind;
  tabCount: number;
  windowCount: number;
  /** Approximate serialized size in bytes, for the per-session size indicator. */
  bytes: number;
}

/** The single index/pointer record (`idx`). Flipped LAST on every commit so a
 *  crash mid-write can never leave the index pointing at a half-written session. */
export interface SessionIndex {
  version: number;
  order: SessionMeta[];
}

export const INDEX_VERSION = 1;
export const AUTOSAVE_ID = 'autosave';

export const EMPTY_INDEX: SessionIndex = { version: INDEX_VERSION, order: [] };

/* -------------------------------------------------------------------------- */
/* Validation. Deliberately permissive about MISSING optional fields, strict   */
/* about the shape that would corrupt the UI or a restore.                     */
/* -------------------------------------------------------------------------- */

function str(v: unknown, max = 4096): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function bool(v: unknown): boolean {
  return v === true;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Is this URL safe to hand to `tabs.create`? We keep http/https/ftp/file and the
 *  browser's own about:/chrome: pages (restore may fail on some, handled per-tab),
 *  but 🔴 drop `javascript:` and `data:` — restoring those would be a script-exec
 *  or a spoof vector, never a real saved page. */
export function isRestorableUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.trim().toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('blob:')) {
    return false;
  }
  return /^[a-z][a-z0-9+.-]*:/.test(lower);
}

function normalizeTab(raw: unknown): SavedTab | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const url = str(r.url, 8192);
  if (!isRestorableUrl(url)) return null;
  const tab: SavedTab = {
    url,
    title: str(r.title, 1024),
    pinned: bool(r.pinned),
    active: bool(r.active),
    index: num(r.index) ?? 0,
  };
  const fav = str(r.favIconUrl, 8192);
  // 🔴 A favicon can be a data: URL from the page — only keep http(s) ones so we
  // never carry an attacker-controlled data: URI into an <img src>.
  if (fav && /^https?:\/\//i.test(fav)) tab.favIconUrl = fav;
  const gid = num(r.groupId);
  if (gid !== undefined && gid >= 0) tab.groupId = gid;
  const csid = str(r.cookieStoreId, 256);
  if (csid) tab.cookieStoreId = csid;
  return tab;
}

function normalizeGroup(raw: unknown): SavedGroup | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const gid = num(r.groupId);
  if (gid === undefined) return null;
  const g: SavedGroup = { groupId: gid };
  const title = str(r.title, 256);
  if (title) g.title = title;
  const color = str(r.color, 32);
  if (color) g.color = color;
  if (r.collapsed !== undefined) g.collapsed = bool(r.collapsed);
  return g;
}

function normalizeWindow(raw: unknown): SavedWindow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const rawTabs = Array.isArray(r.tabs) ? r.tabs : [];
  const tabs = rawTabs.map(normalizeTab).filter((t): t is SavedTab => t !== null);
  if (tabs.length === 0) return null; // an empty window is not worth restoring
  const win: SavedWindow = { incognito: bool(r.incognito), tabs };
  const state = str(r.state, 32);
  if (state) win.state = state;
  for (const k of ['left', 'top', 'width', 'height'] as const) {
    const v = num(r[k]);
    if (v !== undefined) win[k] = v;
  }
  if (Array.isArray(r.groups)) {
    const groups = r.groups.map(normalizeGroup).filter((g): g is SavedGroup => g !== null);
    if (groups.length) win.groups = groups;
  }
  return win;
}

/**
 * Coerce an untrusted value into a valid SavedSession, or return `null` if it is
 * too broken to use. 🔴 Returning null (not throwing) is the contract that lets the
 * caller QUARANTINE one bad key and keep every other session — the direct answer to
 * Session Buddy's all-or-nothing data loss.
 */
export function normalizeSession(raw: unknown, fallbackId?: string): SavedSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 128) || fallbackId || '';
  if (!id) return null;
  const rawWindows = Array.isArray(r.windows) ? r.windows : [];
  const windows = rawWindows.map(normalizeWindow).filter((w): w is SavedWindow => w !== null);
  if (windows.length === 0) return null;
  const now = Date.now();
  const created = num(r.createdAt) ?? now;
  return {
    id,
    name: str(r.name, 200) || defaultSessionName(created),
    createdAt: created,
    updatedAt: num(r.updatedAt) ?? created,
    kind: r.kind === 'autosave' ? 'autosave' : 'manual',
    windows,
  };
}

/** Cheap boolean gate used where a full normalize is not needed. */
export function isValidSession(raw: unknown): boolean {
  return normalizeSession(raw) !== null;
}

/* -------------------------------------------------------------------------- */
/* Derivations                                                                 */
/* -------------------------------------------------------------------------- */

export function tabCount(session: SavedSession): number {
  return session.windows.reduce((n, w) => n + w.tabs.length, 0);
}

/** Approximate stored size, using the same UTF-8 accounting storage.local uses. */
export function sessionBytes(session: SavedSession): number {
  return new TextEncoder().encode(JSON.stringify(session)).length;
}

export function toMeta(session: SavedSession): SessionMeta {
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    kind: session.kind,
    tabCount: tabCount(session),
    windowCount: session.windows.length,
    bytes: sessionBytes(session),
  };
}

/** A stable, locale-neutral default name (`Session 2026-07-20 14:32`). The UI can
 *  rename it; this is only the seed so a saved session is never nameless. */
export function defaultSessionName(when = Date.now()): string {
  const d = new Date(when);
  const p = (n: number) => String(n).padStart(2, '0');
  return `Session ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

/** Drop duplicate URLs within each window, keeping the first occurrence (design
 *  §14: "dedupe identical URLs on save"). Cross-window duplicates are kept — the
 *  same doc open in two windows is intentional. */
export function dedupeSession(session: SavedSession): SavedSession {
  return {
    ...session,
    windows: session.windows.map((w) => {
      const seen = new Set<string>();
      const tabs = w.tabs.filter((t) => {
        if (seen.has(t.url)) return false;
        seen.add(t.url);
        return true;
      });
      return { ...w, tabs };
    }),
  };
}

/** A fresh id. `crypto.randomUUID` exists in every extension context incl. the SW. */
export function newSessionId(): string {
  return crypto.randomUUID();
}
