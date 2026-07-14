import { defineContentScript } from '#imports';
import type {
  BlurExtensionSettings,
  BlurSiteConfig,
  BlurTabStats,
  DomRule,
  EngineStats,
  MaskStyle,
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
  clampMaskOpacity,
  isAllowlisted,
  resolveBlurSettings,
  resolveRevealMode,
  safeMaskColor,
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
import { LabelOverlay } from '../utils/label-overlay';

/**
 * Can the primary pointer hover? On a phone it cannot, and `reveal: 'hover'` —
 * the DEFAULT — would leave every masked element permanently unrevealable. This
 * is read once: a device does not grow a mouse mid-session, and matchMedia here
 * keeps core DOM-free.
 */
const CAN_HOVER = (() => {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    // Ancient/exotic engine with no matchMedia: assume a pointer device, which
    // preserves the existing desktop behaviour.
    return true;
  }
})();

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
  // The mask style must be cached too. Without it the pre-paint sheet would
  // always use blur, so a user who chose a solid mask would see their media
  // blurred for one frame and then snap to a solid box — and, worse, a blur is a
  // weaker mask than the one they explicitly asked for.
  maskStyle: MaskStyle;
  maskColor: string;
  maskOpacity: number;
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
      // This value is read back out of page-controlled localStorage, so it is
      // untrusted input on the path into an SVG data-URI. safeMaskColor is the
      // sanitizer, and it is applied HERE, at the trust boundary.
      maskStyle: p.maskStyle === 'solid' ? 'solid' : 'blur',
      maskColor: safeMaskColor(p.maskColor),
      maskOpacity: clampMaskOpacity(
        typeof p.maskOpacity === 'number' ? p.maskOpacity : 1,
      ),
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
      maskStyle: p.maskStyle,
      maskColor: p.maskColor,
      maskOpacity: p.maskOpacity,
      // Chips are drawn by JS after settings resolve; they have no place in the
      // synchronous pre-paint sheet.
      showLabels: false,
      rehideOnBlur: false,
    },
  });
}

type ContentMessage =
  | { type: 'revealAll' }
  | { type: 'hideAll' }
  | { type: 'reevaluate' }
  | { type: 'blurElement' }
  /**
   * "What are you ACTUALLY applying right now?" — asked by the popup on open.
   *
   * A content script injected before an extension update is orphaned: it keeps the
   * stylesheet it already adopted (so the page still looks masked) but it no longer
   * receives storage events or messages. The popup, which is always freshly loaded,
   * therefore shows the new settings while the page silently ignores them — and the
   * feature reads as broken, with nothing anywhere to explain why. That is a browser
   * constraint, not something the dead script can fix; but a LIVE script can answer
   * this ping, so silence is itself the diagnosis.
   */
  | { type: 'whatIsApplied' };

/** The content script's honest report of what it is currently enforcing. */
export interface AppliedInfo {
  active: boolean;
  maskStyle: MaskStyle;
  radius: number;
  reveal: RevealMode;
}

const MANUAL_BLUR_ATTR = 'data-bx-manual';
/** Root flag that reveals manually-blurred elements WITHOUT discarding them. */
const MANUAL_REVEAL_ATTR = 'data-bx-manual-revealed';

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
    let labels: LabelOverlay | undefined;
    let labelSync: (() => void) | undefined;
    /** The mask style the CURRENTLY-INJECTED stylesheet was built with. */
    let appliedMaskStyle: MaskStyle = 'blur';
    let removeRehideOnBlur: (() => void) | undefined;

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
          maskStyle: cached.maskStyle,
          maskColor: cached.maskColor,
          maskOpacity: cached.maskOpacity,
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
        maskStyle: DEFAULT_BLUR_SETTINGS.blur.maskStyle,
        maskColor: DEFAULT_BLUR_SETTINGS.blur.maskColor,
        maskOpacity: DEFAULT_BLUR_SETTINGS.blur.maskOpacity,
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
      // The engine already batches its own mutation handling, so piggy-backing on
      // its stats tick picks up lazily-appended feed content without a second
      // MutationObserver competing with it.
      labelSync?.();
      report();
    }

    function stopEngine(): void {
      engine?.stop();
      engine = undefined;
      latestEngineStats = undefined;
      removeClickReveal?.();
      removeClickReveal = undefined;
      labels?.destroy();
      labels = undefined;
      labelSync = undefined;
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
      removeRehideOnBlur?.();
      removeRehideOnBlur = undefined;
      stopEngine();
      stopText();
      stopImageGate();
    }

    /**
     * Re-hide everything the moment the tab stops being looked at.
     *
     * The whole premise of this extension is that sensitive content is not on
     * screen when someone else can see it. A reveal that survives an alt-tab, a
     * screen share, or a phone being handed over defeats that — so when the
     * option is on, backgrounding the tab (or the window losing focus) instantly
     * puts every mask back.
     *
     * `visibilitychange` covers tab switches and the phone being locked;
     * `blur` covers a window that stays visible but loses focus (a second monitor,
     * a screen-sharing overlay).
     */
    function installRehideOnBlur(): () => void {
      const rehide = (): void => {
        if (document.visibilityState === 'visible' && document.hasFocus()) return;
        hideAllNow();
      };
      document.addEventListener('visibilitychange', rehide);
      window.addEventListener('blur', rehide);
      return () => {
        document.removeEventListener('visibilitychange', rehide);
        window.removeEventListener('blur', rehide);
      };
    }

    function startEngine(rules: DomRule[], settings: BlurExtensionSettings): void {
      // On a touch device 'hover' is a dead end (nothing can ever hover), so it
      // becomes tap-to-reveal. Resolve ONCE and use the same value for the
      // stylesheet, the click handler and the engine — if these disagreed, the
      // sheet would offer a hover affordance no handler backed, or vice versa.
      const reveal = resolveRevealMode(settings.blur.reveal, CAN_HOVER);

      appliedMaskStyle = settings.blur.maskStyle === 'solid' ? 'solid' : 'blur';
      engine = new DomRuleEngine({
        rules,
        blurRadius: settings.blur.radius,
        reveal,
        hostname,
        maskStyle: settings.blur.maskStyle,
        maskColor: settings.blur.maskColor,
        maskOpacity: settings.blur.maskOpacity,
        onStatsChange: onEngineStats,
      });
      // `filter: blur()` on a playing <video> knocks it off the hardware-overlay
      // compositing path, so blurred video costs real GPU and battery. A solid
      // mask is a single flood — no convolution — so it is markedly cheaper, which
      // is why it is the better default on mobile.
      engine.start();

      // "What's under the mask?" chips. Built only when asked for: when the
      // option is off, no overlay, no observers, no cost at all.
      if (settings.blur.showLabels) {
        labels = new LabelOverlay();
        labels.start();
        const selector = rules.map((r) => r.selector).join(',');
        if (selector) {
          const sync = (): void => {
            try {
              labels?.track(deepQuerySelectorAll(document, selector));
            } catch {
              // A malformed user selector must not take the page down.
            }
          };
          sync();
          // Feeds append content forever; re-sync on the engine's own stats tick
          // rather than running a second MutationObserver of our own.
          labelSync = sync;
        }
      }

      if (reveal === 'click') {
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
      /**
       * Mask style + colour + opacity + label toggle, collapsed into one string.
       * All of them live in the injected stylesheet (or, for labels, in the
       * overlay built at engine start), so any change to them means the engine
       * must be rebuilt — exactly like radius and reveal. Collapsing them into a
       * single key keeps the comparison below honest instead of growing four more
       * `!==` clauses that are easy to forget to add.
       */
      maskKey: string;
      rehideOnBlur: boolean;
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
        maskStyle: settings.blur.maskStyle,
        maskColor: safeMaskColor(settings.blur.maskColor),
        maskOpacity: clampMaskOpacity(settings.blur.maskOpacity),
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
          maskKey: '',
          rehideOnBlur: false,
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
      const maskKey = [
        settings.blur.maskStyle,
        settings.blur.maskColor,
        settings.blur.maskOpacity,
        settings.blur.showLabels,
      ].join('|');

      // Re-hide-on-blur is independent of the engine: it only listens for the tab
      // losing focus, so it can be toggled without a rebuild.
      if (settings.blur.rehideOnBlur !== (applied?.active ? applied.rehideOnBlur : false)) {
        removeRehideOnBlur?.();
        removeRehideOnBlur = settings.blur.rehideOnBlur ? installRehideOnBlur() : undefined;
      }

      if (rules.length === 0) {
        stopEngine();
      } else if (
        !engine ||
        !applied?.active ||
        radius !== applied.radius ||
        reveal !== applied.reveal ||
        maskKey !== applied.maskKey
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
        maskKey,
        rehideOnBlur: settings.blur.rehideOnBlur,
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
              `[${MANUAL_BLUR_ATTR}]:hover{filter:none!important}` +
              // "Reveal all" must be REVERSIBLE. It used to call clearManualBlur(),
              // which stripped the attribute and tore down this sheet — destroying
              // every hand-picked blur permanently, with no way back short of
              // re-picking each element. Instead the reveal is expressed as a flag
              // on the root, exactly like the engine's REVEAL_ATTR: the elements
              // keep their marks, so hiding again is one attribute away.
              `:root[${MANUAL_REVEAL_ATTR}] [${MANUAL_BLUR_ATTR}]{filter:none!important}`,
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

    /** Reveal everything on the page, reversibly. */
    function revealAllNow(): void {
      engine?.revealAll();
      textBlurrer?.revealAll();
      // Flag, not destruction — see the manual stylesheet above.
      document.documentElement.setAttribute(MANUAL_REVEAL_ATTR, '');
      labelSync?.();
      scheduleRehide();
    }

    /**
     * The inverse of "Reveal all", which the UI previously did not have at all:
     * once you revealed a page there was no way back except a full reload. For an
     * extension whose whole job is keeping content off the screen, a one-way
     * reveal is the wrong shape — the moment you most need to re-hide (someone
     * walked over) is exactly when reloading the page is the slowest option.
     *
     * Restores all three reveal mechanisms, which are deliberately independent:
     * the engine's per-element attribute, the text blurrer's own root attribute,
     * and the manual-blur reveal flag.
     */
    function hideAllNow(): void {
      clearTimeout(rehideTimer);
      rehideTimer = undefined;
      for (const el of deepQuerySelectorAll(document, `[${REVEAL_ATTR}]`)) {
        el.removeAttribute(REVEAL_ATTR);
      }
      textBlurrer?.reblur();
      document.documentElement.removeAttribute(MANUAL_REVEAL_ATTR);
      labelSync?.();
    }

    // Undo a "reveal all" once the reveal-timeout elapses: re-blur the engine's
    // elements (dropping REVEAL_ATTR restores the CSS) and the text.
    function scheduleRehide(): void {
      clearTimeout(rehideTimer);
      rehideTimer = undefined;
      if (prefs.revealTimeoutSec <= 0) return;
      rehideTimer = setTimeout(() => {
        rehideTimer = undefined;
        hideAllNow();
      }, prefs.revealTimeoutSec * 1000);
    }

    browser.runtime.onMessage.addListener((
      message: ContentMessage,
      _sender: unknown,
      sendResponse: (response: AppliedInfo) => void,
    ) => {
      if (message?.type === 'whatIsApplied') {
        // Answer from the RECONCILED state, never by re-reading storage: a stale
        // script must not be able to look healthy by reporting what it SHOULD be
        // doing instead of what it IS doing. (A stale script never gets here at
        // all — its listener is dead — and that silence is the whole signal.)
        sendResponse({
          active: !!applied?.active,
          maskStyle: appliedMaskStyle,
          radius: applied?.radius ?? 0,
          reveal: (applied?.reveal as RevealMode) || 'never',
        });
        return true;
      }
      if (message?.type === 'revealAll') {
        revealAllNow();
      } else if (message?.type === 'hideAll') {
        hideAllNow();
      } else if (message?.type === 'reevaluate') {
        void apply();
      } else if (message?.type === 'blurElement') {
        if (lastContextTarget?.isConnected) blurElement(lastContextTarget);
      }
    });

    // FAIL CLOSED on invalidation (an extension update, or a reload in dev).
    //
    // This used to call teardown() + clearManualBlur() + clearPreblur(), which
    // removes every injected stylesheet and strips the engine's attributes. The
    // effect: the instant the extension updated, every open tab REPAINTED THE
    // CONTENT IT WAS HIDING — no user action, no warning. That is the one thing
    // this extension must never do.
    //
    // Now the masks stay exactly as they are and only the machinery stops: the
    // observers are disconnected (nothing will ever tear them down otherwise, so
    // they would leak), and the storage watchers are released. The page stays
    // masked, frozen, until it is reloaded — at which point the new content
    // script takes over cleanly.
    //
    // Note this is also why a page open across an extension update stops
    // responding to the popup: its content script is orphaned. That is a browser
    // constraint, not a bug we can fix from inside the dead context — but freezing
    // means the failure is "settings don't apply until you reload", never
    // "your content is suddenly on screen".
    ctx.onInvalidated(() => {
      clearTimeout(rehideTimer);
      rehideTimer = undefined;
      removeRehideOnBlur?.();
      removeClickReveal?.();
      removeImageGate?.();
      labels?.destroy();
      // Freeze, do NOT stop: stop() removes the stylesheets and un-hides the page.
      engine?.freeze();
      // The text blurrer's CSS stays applied for the same reason; only its
      // observer is released.
      textBlurrer?.freeze();
      unwatchSettings();
      unwatchSites();
      unwatchImageRules();
      unwatchPrefs();
    });
  },
});
