import type { AdBlockTabStats, AggregateStats, CountAccuracy } from '@blur/core';
import { statsItem, statsMetaItem } from './storage';

export type TabDisplayStats = Pick<
  AdBlockTabStats,
  'cosmeticHidden' | 'networkBlocked' | 'trackersBlocked' | 'accuracy'
>;

function emptyTab(accuracy: CountAccuracy): TabDisplayStats {
  return { cosmeticHidden: 0, networkBlocked: 0, trackersBlocked: 0, accuracy };
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO-week key, e.g. "2026-W28", so the weekly bucket rolls on week change. */
function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * In-memory counters flushed to storage.local in ONE batched write (PLAN.md §5).
 *
 * ⚠️ Never write on every event: the MV3 service worker dies after ~30s idle. We
 * flush on a 30s `chrome.alarms` tick and on `runtime.onSuspend`. The worker can
 * still be killed before a final flush, so the last <30s window of increments may
 * be lost — cumulative totals are therefore approximate-by-a-little by design.
 */
export class StatsStore {
  #tabs = new Map<number, TabDisplayStats>();
  #pending = 0; // cumulative increments not yet flushed
  #dirty = false;
  #accuracy: CountAccuracy;

  constructor(accuracy: CountAccuracy) {
    this.#accuracy = accuracy;
  }

  getTab(tabId: number): TabDisplayStats {
    return this.#tabs.get(tabId) ?? emptyTab(this.#accuracy);
  }

  /**
   * Record cosmetic hides. `total` is the tab's cumulative hidden count (for the
   * badge); `delta` is the increment SINCE THE LAST REPORT, computed by the
   * content script — NOT re-derived here from a per-tab baseline.
   *
   * WHY the content script owns the delta: the previous design accrued
   * `total - inMemoryBaseline`, but that baseline lived only in this service
   * worker's map, which is wiped when the idle MV3 worker is torn down (~30s).
   * After a restart the baseline reset to 0, so the next full cumulative report
   * was re-added in its entirety, inflating the aggregate on every SW cycle. The
   * content script survives SW death and tracks its own last-reported value, so
   * the delta it sends is always correct. Cosmetic hides are exact everywhere.
   */
  recordCosmetic(tabId: number, total: number, delta: number): void {
    const tab = this.#tabs.get(tabId) ?? emptyTab(this.#accuracy);
    tab.cosmeticHidden = total;
    this.#tabs.set(tabId, tab);
    if (delta > 0) this.#accrue(delta);
  }

  /**
   * Record absolute per-tab network/tracker counts (exact on Firefox). The
   * increase over the previous reading feeds the cumulative bucket.
   */
  setNetwork(tabId: number, network: number, trackers: number, accuracy: CountAccuracy): void {
    const tab = this.#tabs.get(tabId) ?? emptyTab(accuracy);
    const delta = Math.max(0, network - tab.networkBlocked) + Math.max(0, trackers - tab.trackersBlocked);
    tab.networkBlocked = network;
    tab.trackersBlocked = trackers;
    tab.accuracy = accuracy;
    this.#tabs.set(tabId, tab);
    if (delta > 0) this.#accrue(delta);
  }

  clearTab(tabId: number): void {
    this.#tabs.delete(tabId);
  }

  #accrue(n: number): void {
    this.#pending += n;
    this.#dirty = true;
  }

  /** Single batched write. Rolls day/week buckets on date change. */
  async flush(): Promise<void> {
    if (!this.#dirty) return;
    const add = this.#pending;
    this.#pending = 0;
    this.#dirty = false;

    const now = new Date();
    const dk = dayKey(now);
    const wk = weekKey(now);
    const [current, meta] = await Promise.all([statsItem.getValue(), statsMetaItem.getValue()]);

    const today = (meta.dayKey === dk ? current.today : 0) + add;
    const week = (meta.weekKey === wk ? current.week : 0) + add;
    const total = current.total + add;

    // The aggregate is ALWAYS 'exact': the only things accrued into it are
    // exactly-counted increments — cosmetic hides on every browser, plus exact
    // webRequest network/tracker blocks on Firefox. Chromium's approximate DNR
    // figures are per-tab and on-demand (popup only); they never reach this
    // cumulative bucket. So the stored accuracy does not depend on `#accuracy`.
    const next: AggregateStats = {
      ...current,
      today,
      week,
      total,
      accuracy: 'exact',
    };
    await Promise.all([
      statsItem.setValue(next),
      statsMetaItem.setValue({ dayKey: dk, weekKey: wk }),
    ]);
  }
}
