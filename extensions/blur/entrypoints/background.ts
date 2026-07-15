import { defineBackground } from '#imports';
import type { BlurExtensionSettings, BlurTabStats } from '@blur/core';
import { isAllowlisted } from '@blur/core';
import {
  settingsItem,
  siteConfigsItem,
  panicSnapshotItem,
  localeItem,
  withSettingsLock,
  withStorageLock,
} from '../utils/storage';
import { togglePanic, setSiteOverride } from '../utils/features';
import { tAt } from '../utils/i18n';

// Shape mirrors `BlurProtocol` in @blur/core. `stats` is the content-script
// report; the rest are popup/options round-trips.
type BlurMessage =
  | { type: 'getSettings' }
  | { type: 'setSettings'; next: BlurExtensionSettings }
  | { type: 'getTabStats'; tabId: number }
  | { type: 'toggleSite'; hostname: string }
  | { type: 'revealAll'; tabId: number }
  | { type: 'hideAll'; tabId: number }
  | { type: 'stats'; stats: BlurTabStats };

export default defineBackground({
  main() {
    // Per-tab stats, populated from content-script reports. The content script
    // measures what it blurred from the engine's own tally (unlike the network
    // counts in the ad-block add-on); the number can run marginally high when the
    // min-image-size gate un-blurs an already-tallied small image without
    // subtracting it, so it is an honest measured count, not an exact one.
    //
    // MV3 SERVICE WORKER: this dies after ~30s idle, so these in-memory counters
    // are ephemeral. That is acceptable for per-tab counts — the content script
    // re-reports on demand and re-populates the map. There is no cumulative
    // counter to persist, so this extension deliberately adds no `chrome.alarms`.
    const tabStats = new Map<number, BlurTabStats>();
    /**
     * Tabs the user has revealed wholesale, so the keyboard shortcut can be a
     * TOGGLE rather than a one-way door. Reveal-all had no inverse: once a page
     * was revealed the only way back was a full reload, which is absurd for an
     * extension whose job is keeping content off the screen — the moment you most
     * need to re-hide is the moment reloading is slowest. Kept in memory only:
     * a reveal is per-page and must never survive a navigation or a restart.
     */
    const revealedTabs = new Set<number>();

    function emptyStats(tabId: number): BlurTabStats {
      return {
        tabId,
        hostname: '',
        imagesBlurred: 0,
        videosBlurred: 0,
        textMatchesBlurred: 0,
      };
    }

    function updateBadge(tabId: number): void {
      const stats = tabStats.get(tabId);
      const total = stats
        ? stats.imagesBlurred + stats.videosBlurred + stats.textMatchesBlurred
        : 0;
      // `browser.action` is MV3; Firefox MV2 exposes `browserAction`. WXT emits
      // the right manifest key per target, so guard the API lookup here.
      const action = browser.action ?? browser.browserAction;
      void action?.setBadgeText({ tabId, text: total > 0 ? String(total) : '' });
    }

    async function reevaluateHost(hostname: string): Promise<void> {
      // Tell every open tab on that host to re-apply without a reload.
      const tabs = await browser.tabs.query({});
      for (const tab of tabs) {
        if (typeof tab.id !== 'number' || !tab.url) continue;
        let host = '';
        try {
          host = new URL(tab.url).hostname;
        } catch {
          continue;
        }
        if (host !== hostname) continue;
        void browser.tabs.sendMessage(tab.id, { type: 'reevaluate' }).catch(() => {
          // No content script on that tab (e.g. chrome:// page) — ignore.
        });
      }
    }

    browser.runtime.onMessage.addListener((message: BlurMessage, sender, sendResponse) => {
      void (async () => {
        switch (message.type) {
          case 'getSettings':
            sendResponse(await settingsItem.getValue());
            return;
          case 'setSettings':
            await settingsItem.setValue(message.next);
            sendResponse(true);
            return;
          case 'getTabStats':
            sendResponse(tabStats.get(message.tabId) ?? emptyStats(message.tabId));
            return;
          case 'toggleSite': {
            // Web Locks serialize this read-modify-write against the popup /
            // options writers (which take the same lock in use-settings), so a
            // concurrent edit in another context cannot clobber the allowlist.
            const nowAllowed = await withSettingsLock(async () => {
              const settings = await settingsItem.getValue();
              const allow = new Set(settings.allowlist);
              // Subdomain-aware membership: don't add a redundant subdomain entry
              // when a parent domain already allowlists it.
              const willAllow = !isAllowlisted(settings.allowlist, message.hostname);
              if (willAllow) allow.add(message.hostname);
              else allow.delete(message.hostname);
              await settingsItem.setValue({ ...settings, allowlist: [...allow] });
              return willAllow;
            });
            await reevaluateHost(message.hostname);
            sendResponse(nowAllowed);
            return;
          }
          case 'revealAll': {
            const tabId = message.tabId ?? sender.tab?.id;
            if (typeof tabId === 'number') {
              await browser.tabs.sendMessage(tabId, { type: 'revealAll' }).catch(() => {});
              revealedTabs.add(tabId);
            }
            sendResponse(true);
            return;
          }
          case 'hideAll': {
            const tabId = message.tabId ?? sender.tab?.id;
            if (typeof tabId === 'number') {
              await browser.tabs.sendMessage(tabId, { type: 'hideAll' }).catch(() => {});
              revealedTabs.delete(tabId);
            }
            sendResponse(true);
            return;
          }
          case 'stats': {
            // A content script cannot know its own tab id — take it from the sender.
            const tabId = sender.tab?.id;
            if (typeof tabId === 'number') {
              tabStats.set(tabId, { ...message.stats, tabId });
              updateBadge(tabId);
            }
            sendResponse(true);
            return;
          }
        }
      })();
      // Keep the channel open for the async responder (needed until Chrome 148,
      // where returning a Promise supersedes this — PLAN.md §13).
      return true;
    });

    async function hostnameOfTab(tabId: number): Promise<string | undefined> {
      try {
        const tab = await browser.tabs.get(tabId);
        return tab.url ? new URL(tab.url).hostname : undefined;
      } catch {
        return undefined;
      }
    }

    /* ---- Feature 3: keyboard shortcuts (commands) ------------------- */
    browser.commands?.onCommand.addListener((command) => {
      void (async () => {
        if (command === 'toggle-global') {
          await withSettingsLock(async () => {
            const settings = await settingsItem.getValue();
            await settingsItem.setValue({ ...settings, enabled: !settings.enabled });
          });
          return;
        }
        if (command === 'reveal-all') {
          // A toggle, not a one-way reveal: press once to look, press again to put
          // it all back. Same key, no reload, no hunting for the popup.
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (typeof tab?.id === 'number') {
            const revealed = revealedTabs.has(tab.id);
            const type = revealed ? 'hideAll' : 'revealAll';
            await browser.tabs.sendMessage(tab.id, { type }).catch(() => {});
            if (revealed) revealedTabs.delete(tab.id);
            else revealedTabs.add(tab.id);
          }
          return;
        }
        if (command === 'panic-blur') {
          await withSettingsLock(async () => {
            const [current, snapshot] = await Promise.all([
              settingsItem.getValue(),
              panicSnapshotItem.getValue(),
            ]);
            const { settings, snapshot: nextSnapshot } = togglePanic(current, snapshot);
            await panicSnapshotItem.setValue(nextSnapshot);
            await settingsItem.setValue(settings);
          });
        }
      })();
    });

    /* ---- Feature 4: context menu ------------------------------------ */
    const MENU_BLUR_THIS = 'bx-blur-this';
    const MENU_ALWAYS_IMAGES = 'bx-always-images';

    // Menu titles follow the user's chosen UI language (default English), read
    // from the same persisted `local:locale` the popup/options switcher writes.
    async function createMenus(): Promise<void> {
      const locale = await localeItem.getValue();
      browser.contextMenus?.removeAll(() => {
        browser.contextMenus?.create({
          id: MENU_BLUR_THIS,
          title: tAt(locale, 'menu_blur_this'),
          contexts: ['image', 'video', 'all'],
        });
        browser.contextMenus?.create({
          id: MENU_ALWAYS_IMAGES,
          title: tAt(locale, 'menu_always_images'),
          contexts: ['image', 'all'],
        });
      });
    }
    browser.runtime.onInstalled.addListener(() => void createMenus());
    browser.runtime.onStartup?.addListener(() => void createMenus());
    void createMenus();
    // Re-title live when the user switches language, so the menu never lags the UI.
    localeItem.watch(() => void createMenus());

    browser.contextMenus?.onClicked.addListener((info, tab) => {
      void (async () => {
        if (info.menuItemId === MENU_BLUR_THIS) {
          if (typeof tab?.id === 'number') {
            await browser.tabs.sendMessage(tab.id, { type: 'blurElement' }).catch(() => {});
          }
          return;
        }
        if (info.menuItemId === MENU_ALWAYS_IMAGES) {
          const hostname =
            typeof tab?.id === 'number' ? await hostnameOfTab(tab.id) : undefined;
          if (!hostname) return;
          // Serialize this read-modify-write under the SAME per-item lock the
          // popup / options `useStorageItem` writers take (keyed on the storage
          // key), so a concurrent per-site edit in another context cannot clobber
          // the override just added here (V6).
          await withStorageLock(siteConfigsItem.key, async () => {
            const configs = await siteConfigsItem.getValue();
            await siteConfigsItem.setValue(
              setSiteOverride(configs, hostname, { blur: { images: true } }),
            );
          });
          await reevaluateHost(hostname);
        }
      })();
    });

    browser.tabs.onActivated.addListener(({ tabId }) => updateBadge(tabId));

    browser.tabs.onRemoved.addListener((tabId) => {
      tabStats.delete(tabId);
      revealedTabs.delete(tabId);
    });

    // Clear on navigation. `webNavigation` is NOT a granted permission, so use
    // `tabs.onUpdated` and reset when the tab starts loading a new document.
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'loading') {
        tabStats.delete(tabId);
        // A new document starts hidden again, so the toggle must not think the
        // page is still revealed.
        revealedTabs.delete(tabId);
        updateBadge(tabId);
      }
    });
  },
});
