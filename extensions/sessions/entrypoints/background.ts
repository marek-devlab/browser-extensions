import { defineBackground, browser } from '#imports';
import { captureLiveSnapshot } from '../utils/capture';
import { settingsItem, sweepOrphans, writeAutosave } from '../utils/storage';

// Auto-save + crash recovery under MV3 (PLAN.md §14.5).
//
// 🔴 THE SERVICE WORKER DIES IN ~30s. So we hold NO session state in SW memory:
// every listener wakes the SW, writes ONE debounced snapshot straight to
// storage.local, and lets it go. A `chrome.alarms` heartbeat (min 30s) re-persists
// the live set even during a long quiet period, so the last-known-good autosave is
// never more than the heartbeat old. On startup the popup offers to restore
// `sess:autosave` — that is the crash-recovery path.
//
// The debounce timer below only has to survive a single burst of events (which keep
// the SW briefly alive); it is intentionally NOT relied on across SW deaths — the
// alarm is. Both paths funnel through `snapshot()`.

const HEARTBEAT_ALARM = 'sessions:heartbeat';
const DEBOUNCE_MS = 1500;

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

async function autoSaveOn(): Promise<boolean> {
  try {
    const settings = await settingsItem.getValue();
    return settings.autoSaveEnabled !== false;
  } catch {
    return true; // default-on; a failed read must not silently disable recovery
  }
}

/** Capture the live window set and write it to the rolling autosave key. Guarded so
 *  a transient failure (window closing mid-capture) never throws out of a listener. */
async function snapshot(): Promise<void> {
  try {
    if (!(await autoSaveOn())) return;
    const session = await captureLiveSnapshot();
    // Never overwrite a good autosave with an empty one (e.g. the last window is
    // mid-close) — that would erase the very thing crash-recovery needs.
    if (session) await writeAutosave(session);
  } catch {
    /* best effort — the next event or heartbeat will try again */
  }
}

function scheduleSnapshot(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    void snapshot();
  }, DEBOUNCE_MS);
}

export default defineBackground(() => {
  // One-time housekeeping: drop orphan `sess:*` keys left by any interrupted write.
  void sweepOrphans();

  // Event-driven persistence. Each of these wakes the SW; we coalesce a burst into
  // a single write via the short debounce, then the SW is free to die again.
  const onChange = () => scheduleSnapshot();
  browser.tabs.onCreated.addListener(onChange);
  browser.tabs.onRemoved.addListener(onChange);
  browser.tabs.onMoved.addListener(onChange);
  browser.tabs.onUpdated.addListener((_id, changeInfo) => {
    // Only URL/title/pin changes affect a saved snapshot — ignore the noisy
    // status/audible/favicon churn so we don't rewrite storage on every keystroke.
    if (
      changeInfo.url !== undefined ||
      changeInfo.title !== undefined ||
      changeInfo.pinned !== undefined
    ) {
      scheduleSnapshot();
    }
  });
  browser.windows.onCreated.addListener(onChange);
  browser.windows.onRemoved.addListener(onChange);

  // Heartbeat: re-persist even with no events, and survive SW deaths (the timer
  // above does not). `periodInMinutes` min is ~0.5 on Chrome; 1 min is plenty.
  browser.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEARTBEAT_ALARM) void snapshot();
  });

  // Take one snapshot right after (re)start so recovery has something immediately.
  void snapshot();
});
