import { defineContentScript } from '#imports';
import type {
  BlurExtensionSettings,
  BlurSiteConfig,
  BlurTabStats,
  DomRule,
  EngineStats,
  RevealMode,
} from '@blur/core';
import {
  BLUR_SELECTORS,
  DEFAULT_BLUR_SETTINGS,
  DomRuleEngine,
  REVEAL_ATTR,
  applyStylesheet,
  buildStylesheet,
  deepQuerySelectorAll,
  isAllowlisted,
  resolveBlurSettings,
  scheduleTask,
} from '@blur/core';
import {
  settingsItem,
  siteConfigsItem,
  imageSourceRulesItem,
  extensionPrefsItem,
  type ImageSourceRules,
  type ExtensionPrefs,
} from '../utils/storage';
import { createTextBlurrer, type TextBlurrer } from '../utils/text-blur';
import { installClickReveal } from '../utils/reveal';
import { buildImageSelector, buildLinkSelector } from '../utils/features';
import { installImageSizeGate } from '../utils/image-gate';

const EMPTY_IMAGE_RULES: ImageSourceRules = { never: [], always: [] };
const DEFAULT_PREFS: ExtensionPrefs = { revealTimeoutSec: 0, minImagePx: 0, linkDomains: [] };

// Every rule is a blur action — this extension has no `hide` path (that lives in
// the separate ad-block add-on). Selectors come from core's BLUR_SELECTORS, and
// each rule carries a `label` so exact per-category counts come straight from
// `engine.stats.byLabel` — no per-tick DOM re-scan.
function rulesFromSettings(
  settings: BlurExtensionSettings,
  imageRules: ImageSourceRules = EMPTY_IMAGE_RULES,
  linkDomains: readonly string[] = [],
): DomRule[] {
  const rules: DomRule[] = [];
  // Feature 6: the effective <img> selector excludes "never" domains and adds
  // "always" domains even when the Images category is off, so build it whether or
  // not `images` is on and push only if it selects something.
  const imageSelector = buildImageSelector(settings.blur.images, imageRules);
  if (imageSelector)
    rules.push({ selector: imageSelector, action: 'blur', label: 'images' });
  if (settings.blur.video)
    rules.push({ selector: BLUR_SELECTORS.video, action: 'blur', label: 'video' });
  if (settings.blur.posters)
    rules.push({ selector: BLUR_SELECTORS.posters, action: 'blur', label: 'posters' });
  // SERP / domain link hiding: blur result cards linking to a listed domain.
  const linkSelector = buildLinkSelector(linkDomains);
  if (linkSelector)
    rules.push({ selector: linkSelector, action: 'blur', label: 'links' });
  return rules;
}

/* ---- C7: pre-blur profile cache -------------------------------------- */
// The block-first sheet must land synchronously at document_start, before the
// first `await`. Real settings live in async `storage.local`, which resolves
// only AFTER first paint — too late to decide the sheet. So the last-resolved
// effective profile for THIS origin is cached in page `localStorage`, the only
// synchronous per-origin store available this early. On the next visit the sheet
// is seeded from it, so an allowlisted/disabled site no longer flashes blurred
// (reverse-FOUC) and a customised radius/category set is honoured from frame one.
const PREBLUR_KEY = 'bx:preblur-profile';

interface PreblurProfile {
  active: boolean;
  radius: number;
  reveal: RevealMode;
  images: boolean;
  video: boolean;
  posters: boolean;
}

function readPreblurProfile(): PreblurProfile | null {
  try {
    const raw = window.localStorage.getItem(PREBLUR_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PreblurProfile>;
    const reveal =
      p.reveal === 'hover' || p.reveal === 'click' || p.reveal === 'never'
        ? p.reveal
        : 'hover';
    return {
      active: !!p.active,
      radius: typeof p.radius === 'number' && Number.isFinite(p.radius) ? p.radius : 16,
      reveal,
      images: !!p.images,
      video: !!p.video,
      posters: !!p.posters,
    };
  } catch {
    // No localStorage (sandboxed frame), quota, or malformed JSON — fall back.
    return null;
  }
}

function writePreblurProfile(p: PreblurProfile): void {
  try {
    window.localStorage.setItem(PREBLUR_KEY, JSON.stringify(p));
  } catch {
    // Best-effort cache only; a failure just means the next load falls back.
  }
}

function rulesFromProfile(p: PreblurProfile): DomRule[] {
  return rulesFromSettings({
    enabled: true,
    allowlist: [],
    blur: {
      images: p.images,
      video: p.video,
      posters: p.posters,
      text: false,
      radius: p.radius,
      reveal: p.reveal,
      textPatterns: [],
    },
  });
}

type ContentMessage =
  | { type: 'revealAll' }
  | { type: 'reevaluate' }
  | { type: 'blurElement' };

const MANUAL_BLUR_ATTR = 'data-bx-manual';

export default defineContentScript({
  matches: ['<all_urls>'],
  // BLOCK-FIRST (PLAN.md §3.1): the pre-blur stylesheet must land before first
  // paint or unblurred content flashes (FOUC), because JS always runs after the
  // first render. document_start is mandatory, not an optimization.
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  async main(ctx) {
    const hostname = location.hostname;

    let engine: DomRuleEngine | undefined;
    let textBlurrer: TextBlurrer | undefined;
    let removeClickReveal: (() => void) | undefined;
    let removeImageGate: (() => void) | undefined;
    let latestEngineStats: EngineStats | undefined;
    let reportScheduled = false;
    let prefs: ExtensionPrefs = DEFAULT_PREFS;
    let rehideTimer: ReturnType<typeof setTimeout> | undefined;

    // BLOCK-FIRST / FOUC (#6): the content script's async storage read resolves
    // AFTER first paint, so a conservative pre-blur sheet is injected here,
    // synchronously, before the first `await`. It is seeded from the cached
    // per-origin profile (C7) when we have one — so an allowlisted/disabled site
    // stays sharp and a customised radius/category set is honoured — and falls
    // back to the shipped defaults on the very first visit. `reconcile()` removes
    // it once real settings resolve.
    function injectPreblur(): () => void {
      const cached = readPreblurProfile();
      if (cached) {
        // Cache says this origin is allowlisted or the extension is off — skip
        // pre-blur entirely rather than flashing content the user wants sharp.
        if (!cached.active) return () => {};
        const rules = rulesFromProfile(cached);
        if (rules.length === 0) return () => {};
        const css = buildStylesheet(rules, {
          blurRadius: cached.radius,
          reveal: cached.reveal,
          hostname,
        });
        return css ? applyStylesheet(document, css, 'bx-preblur') : () => {};
      }
      // First visit to this origin: conservative default sheet.
      if (!DEFAULT_BLUR_SETTINGS.enabled) return () => {};
      const rules = rulesFromSettings(DEFAULT_BLUR_SETTINGS);
      if (rules.length === 0) return () => {};
      const css = buildStylesheet(rules, {
        blurRadius: DEFAULT_BLUR_SETTINGS.blur.radius,
        reveal: DEFAULT_BLUR_SETTINGS.blur.reveal,
        hostname,
      });
      if (!css) return () => {};
      return applyStylesheet(document, css, 'bx-preblur');
    }

    let removePreblur: (() => void) | undefined = injectPreblur();
    function clearPreblur(): void {
      removePreblur?.();
      removePreblur = undefined;
    }

    // A content script cannot know its own tab id — the background fills it in
    // from `sender.tab.id`, so `tabId` is a placeholder here. Counts are exact,
    // read straight from the engine's per-label tally (no DOM re-scan). Posters
    // are thumbnails, so they fold into the popup's "Images" bucket.
    function computeStats(): BlurTabStats {
      const byLabel = latestEngineStats?.byLabel ?? {};
      return {
        tabId: -1,
        hostname,
        imagesBlurred: (byLabel['images'] ?? 0) + (byLabel['posters'] ?? 0),
        videosBlurred: byLabel['video'] ?? 0,
        textMatchesBlurred: textBlurrer?.matches ?? 0,
      };
    }

    function report(): void {
      // Coalesce the many onStatsChange / onCount ticks into one message.
      if (reportScheduled) return;
      reportScheduled = true;
      scheduleTask(() => {
        reportScheduled = false;
        void browser.runtime
          .sendMessage({ type: 'stats', stats: computeStats() })
          .catch(() => {
            // Background asleep or no receiver — stats are ephemeral anyway.
          });
      });
    }

    function onEngineStats(stats: EngineStats): void {
      latestEngineStats = stats;
      report();
    }

    function stopEngine(): void {
      engine?.stop();
      engine = undefined;
      latestEngineStats = undefined;
      removeClickReveal?.();
      removeClickReveal = undefined;
    }

    function stopText(): void {
      textBlurrer?.stop();
      textBlurrer = undefined;
    }

    function stopImageGate(): void {
      removeImageGate?.();
      removeImageGate = undefined;
    }

    function teardown(): void {
      clearTimeout(rehideTimer);
      rehideTimer = undefined;
      stopEngine();
      stopText();
      stopImageGate();
    }

    function startEngine(rules: DomRule[], settings: BlurExtensionSettings): void {
      engine = new DomRuleEngine({
        rules,
        blurRadius: settings.blur.radius,
        reveal: settings.blur.reveal,
        hostname,
        onStatsChange: onEngineStats,
      });
      // `filter: blur()` on a playing <video> knocks it off the hardware-overlay
      // compositing path, so blurred video costs real GPU and battery.
      engine.start();
      if (settings.blur.reveal === 'click') {
        removeClickReveal = installClickReveal(
          engine,
          rules.map((r) => r.selector).join(','),
          prefs.revealTimeoutSec,
        );
      }
    }

    // Signature of the currently-applied config, so a settings change only does
    // the minimum work: a radius/reveal change rebuilds the engine but leaves
    // text blur alone, and a category-only change swaps rules in place via
    // `updateRules` rather than a full teardown (#7).
    interface Applied {
      active: boolean;
      radius: number;
      reveal: string;
      rulesKey: string;
      text: boolean;
      patternsKey: string;
      revealTimeout: number;
      minImagePx: number;
    }
    let applied: Applied | undefined;
    let generation = 0;
    let imageRules: ImageSourceRules = EMPTY_IMAGE_RULES;

    async function apply(): Promise<void> {
      const gen = ++generation;
      const [global, siteConfigs, imgRules, prefsValue] = await Promise.all([
        settingsItem.getValue().catch(() => DEFAULT_BLUR_SETTINGS),
        siteConfigsItem.getValue().catch((): Record<string, BlurSiteConfig> => ({})),
        imageSourceRulesItem.getValue().catch(() => EMPTY_IMAGE_RULES),
        extensionPrefsItem.getValue().catch(() => DEFAULT_PREFS),
      ]);
      // A newer apply() started while this one awaited — drop the stale result.
      if (gen !== generation) return;
      imageRules = imgRules;
      prefs = prefsValue;
      reconcile(resolveBlurSettings(global, siteConfigs[hostname]));
    }

    function reconcile(settings: BlurExtensionSettings): void {
      // Subdomain-aware: allowlisting `example.com` also covers `www.example.com`
      // (matches how per-site configs resolve). An exact `.includes` here would
      // leave subdomains blurred AND poison the per-origin pre-blur cache below.
      const active = settings.enabled && !isAllowlisted(settings.allowlist, hostname);

      // C7: persist the effective profile for THIS origin so the next visit's
      // synchronous pre-blur sheet matches reality (skips blur when inactive).
      writePreblurProfile({
        active,
        radius: settings.blur.radius,
        reveal: settings.blur.reveal,
        images: settings.blur.images,
        video: settings.blur.video,
        posters: settings.blur.posters,
      });

      if (!active) {
        teardown();
        clearPreblur();
        applied = {
          active: false,
          radius: 0,
          reveal: '',
          rulesKey: '',
          text: false,
          patternsKey: '',
          revealTimeout: 0,
          minImagePx: 0,
        };
        report();
        return;
      }

      // Min image-size gate: independent of the engine, driven only by minImagePx.
      if (prefs.minImagePx !== (applied?.active ? applied.minImagePx : -1)) {
        stopImageGate();
        if (prefs.minImagePx > 0) removeImageGate = installImageSizeGate(prefs.minImagePx);
      }

      const rules = rulesFromSettings(settings, imageRules, prefs.linkDomains);
      const rulesKey = rules.map((r) => r.selector).join('|');
      const radius = settings.blur.radius;
      const reveal = settings.blur.reveal;
      const revealTimeout = prefs.revealTimeoutSec;

      if (rules.length === 0) {
        stopEngine();
      } else if (
        !engine ||
        !applied?.active ||
        radius !== applied.radius ||
        reveal !== applied.reveal
      ) {
        // A radius or reveal change is not expressible through `updateRules`
        // (both live in the stylesheet), so the engine must be rebuilt — but
        // text blur and other state are left untouched.
        stopEngine();
        startEngine(rules, settings);
      } else if (rulesKey !== applied.rulesKey || revealTimeout !== applied.revealTimeout) {
        if (rulesKey !== applied.rulesKey) {
          engine.updateRules(rules);
          latestEngineStats = undefined;
        }
        if (reveal === 'click') {
          removeClickReveal?.();
          removeClickReveal = installClickReveal(
            engine,
            rules.map((r) => r.selector).join(','),
            revealTimeout,
          );
        }
      }

      const text = settings.blur.text;
      const patternsKey = settings.blur.textPatterns.join('\n');
      if (!text) {
        stopText();
      } else if (
        !textBlurrer ||
        !applied?.active ||
        text !== applied.text ||
        patternsKey !== applied.patternsKey
      ) {
        stopText();
        textBlurrer = createTextBlurrer(settings.blur.textPatterns, report) ?? undefined;
        textBlurrer?.start();
      }

      // The engine's own sheet (or its absence) now reflects real settings.
      clearPreblur();
      applied = {
        active: true,
        radius,
        reveal,
        rulesKey,
        text,
        patternsKey,
        revealTimeout,
        minImagePx: prefs.minImagePx,
      };
      report();
    }

    await apply();

    // React to settings changes live — no page reload (PLAN.md §3, C).
    const unwatchSettings = settingsItem.watch(() => void apply());
    const unwatchSites = siteConfigsItem.watch(() => void apply());
    const unwatchImageRules = imageSourceRulesItem.watch(() => void apply());
    const unwatchPrefs = extensionPrefsItem.watch(() => void apply());

    // Feature 4 (context menu): remember the element under the last right-click so
    // "Blur this element" can act on it. Capture phase so a page that stops the
    // event still lets us record the target. `composedPath()[0]` is the REAL
    // clicked node even inside an open shadow root — `event.target` is retargeted
    // to the shadow host, so it could never reach shadow content (C6).
    let lastContextTarget: Element | undefined;
    const manualSheets = new Map<Document | ShadowRoot, () => void>();
    document.addEventListener(
      'contextmenu',
      (e) => {
        const first = e.composedPath()[0];
        lastContextTarget =
          first instanceof Element
            ? first
            : e.target instanceof Element
              ? e.target
              : undefined;
      },
      { capture: true },
    );

    // Ad-hoc "blur this one element" — independent of the category engine. Hover
    // reveals it so the user can peek; it lasts until navigation. The manual
    // stylesheet is injected into the element's OWN root, so an element inside an
    // open shadow root is reachable (a sheet on `document` does not style shadow
    // content) (C6).
    function blurElement(el: Element): void {
      const node = el.getRootNode();
      const root: Document | ShadowRoot = node instanceof ShadowRoot ? node : document;
      if (!manualSheets.has(root)) {
        const r = DEFAULT_BLUR_SETTINGS.blur.radius;
        manualSheets.set(
          root,
          applyStylesheet(
            root,
            `[${MANUAL_BLUR_ATTR}]{filter:blur(${r}px)!important;transition:filter 120ms ease-out}` +
              `[${MANUAL_BLUR_ATTR}]:hover{filter:none!important}`,
            'bx-manual',
          ),
        );
      }
      el.setAttribute(MANUAL_BLUR_ATTR, '');
    }

    function clearManualBlur(): void {
      for (const remove of manualSheets.values()) remove();
      manualSheets.clear();
      for (const el of deepQuerySelectorAll(document, `[${MANUAL_BLUR_ATTR}]`)) {
        el.removeAttribute(MANUAL_BLUR_ATTR);
      }
    }

    // Undo a "reveal all" once the reveal-timeout elapses: re-blur the engine's
    // elements (dropping REVEAL_ATTR restores the CSS) and the text.
    function scheduleRehide(): void {
      clearTimeout(rehideTimer);
      rehideTimer = undefined;
      if (prefs.revealTimeoutSec <= 0) return;
      rehideTimer = setTimeout(() => {
        rehideTimer = undefined;
        for (const el of deepQuerySelectorAll(document, `[${REVEAL_ATTR}]`)) {
          el.removeAttribute(REVEAL_ATTR);
        }
        textBlurrer?.reblur();
      }, prefs.revealTimeoutSec * 1000);
    }

    browser.runtime.onMessage.addListener((message: ContentMessage) => {
      if (message?.type === 'revealAll') {
        engine?.revealAll();
        textBlurrer?.revealAll();
        clearManualBlur();
        scheduleRehide();
      } else if (message?.type === 'reevaluate') {
        void apply();
      } else if (message?.type === 'blurElement') {
        if (lastContextTarget?.isConnected) blurElement(lastContextTarget);
      }
    });

    ctx.onInvalidated(() => {
      teardown();
      clearManualBlur();
      clearPreblur();
      unwatchSettings();
      unwatchSites();
      unwatchImageRules();
      unwatchPrefs();
    });
  },
});
