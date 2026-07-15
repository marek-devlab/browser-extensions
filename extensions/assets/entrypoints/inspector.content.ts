import { defineContentScript, browser } from '#imports';
import tokensCss from '@blur/ui/tokens.css?inline';
import type { Locale } from '@blur/ui';
import type { ResourceCardModel, SrcsetVerdict, InspectorStartMessage } from '../utils/assets-types';
import { readResourceMetadata, isOpenable } from '../utils/inspect';
import { startPicker, type PickerChrome, type PickerHandle } from '../utils/element-picker';
import { bufferState, raiseBuffer, normalizeUrl } from '../utils/resource-timing';
import { formatDimensions, formatWeight, formatPercent, hostOf, formatDuration } from '../utils/format';
import { assetsPrefsItem, cardPositionItem, localeItem, DEFAULT_PREFS, type AssetsPrefs } from '../utils/storage';
import { tAt, type TFn } from '../utils/i18n';

// The injected inspector overlay — 🥇 THE CORE PRODUCT SURFACE (design §0 И3, §2).
//
// Why it lives in the page and not a popup: the popup DIES on the first page click,
// so "open popup → click element → read result in popup" is physically impossible.
// The result here is a SCREEN to read and compare against the page, so it must be
// an in-page overlay. It renders inside a CLOSED shadow root so a hostile page can
// neither restyle it, hide it, nor read it back (design §9.2).
//
// This is `registration: 'runtime'`: it is NOT auto-injected on any page. The
// background injects it via scripting.executeScript on a user gesture (activeTab).
//
// 🔴 INVARIANTS ENFORCED STRUCTURALLY IN THIS FILE:
//   - ZERO network. There is no fetch/XHR/img.src/video.src/link-preload of any URL
//     we display, anywhere in the extension. The preview is
//     `canvas.drawImage(theExistingElement)` — the browser already loaded it, so the
//     preview costs zero requests (design §0 И1). We never call toDataURL/toBlob, so
//     no code path to the bytes exists: "not a downloader" is true in the code, not
//     just in the listing.
//   - NO file is ever written. Export is `navigator.clipboard.writeText` only. There
//     is no `downloads` permission, no `<a download>`, no createObjectURL (И2).
//   - ZERO innerHTML. Every node is createElement + textContent. The whole card is
//     page-CONTROLLED data (alt, URL, srcset, MIME): parsing any of it as HTML would
//     be XSS in our own overlay (design §9.1).
//   - Styles are a STATIC constructed CSSStyleSheet — never a template string with an
//     interpolated URL (that is CSS injection, design §9.1).
//   - "Open in new tab" is a real <a>, and href is assigned ONLY after the protocol
//     is validated as http/https. A `javascript:` URL in a srcset is the one real
//     attack vector on this card, and it dies here (design §9.1, §4.5).
//   - No manifest is ever opened or parsed. An .m3u8/.mpd may APPEAR in the request
//     list — that is a fact about the page — but nothing reads it (design §13 №2).

const ACTIVE_FLAG = '__assetsInspectorActive';
/** Set once per document: guards the runtime.onMessage registration against the
 *  double-listener leak on re-injection (see main()). */
const LISTENER_FLAG = '__assetsInspectorListener';
/** The Resource Timing cap this document is actually running with (read by the
 *  popup's counter script, which shares this isolated world). */
const LIMIT_FLAG = '__assetsInspectorBufferLimit';
/** Set once the `resourcetimingbufferfull` event has fired — the browser is now
 *  dropping NEW entries. Published here so the popup's counter script (same
 *  isolated world) can report it honestly instead of guessing. */
const OVERFLOW_FLAG = '__assetsInspectorBufferOverflowed';

interface Overlay {
  host: HTMLElement;
  root: ShadowRoot;
  layer: HTMLElement;
  abort: AbortController;
  picker: PickerHandle;
  chrome: PickerChrome;
  card: HTMLElement | null;
  cardObserver: MutationObserver | null;
  returnFocusTo: Element | null;
  prefs: AssetsPrefs;
  overflowed: boolean;
  prevCursor: string;
  /** The persisted UI locale, read once when the overlay boots. */
  locale: Locale;
  /** Locale-bound translator for every string this card renders. */
  t: TFn;
}

let overlay: Overlay | null = null;

/** createElement + textContent. The only node factory in this file — there is no
 *  path here that turns a page string into markup. */
function h(
  tag: string,
  props: { class?: string; text?: string; attrs?: Record<string, string> } = {},
  children: (Node | string)[] = [],
): HTMLElement {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

// @blur/ui is the single token source for the whole family (PLAN.md (Часть II) §7). Inside a
// shadow root `:root` matches nothing, so the SAME stylesheet is re-scoped to
// `:host` — one set of values, no second copy to drift.
const TOKENS = tokensCss.replaceAll(':root', ':host');

const STYLES = `
:host { all: initial; color-scheme: light dark; }
.layer { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
  font: 13px/1.5 var(--sans); }
.ring { position: fixed; box-sizing: border-box;
  /* outline, NOT box-shadow: shadows vanish in forced-colors mode (design §11.3).
     A light + dark double ring reads on both white and black pages (adblock). */
  outline: 2px solid var(--accent); box-shadow: 0 0 0 1px #fff, 0 0 0 3px rgba(0,0,0,.55);
  background: rgba(56,132,255,.16); border-radius: 2px; pointer-events: none; }
@media (prefers-reduced-motion: no-preference) {
  .ring { transition: left 40ms ease-out, top 40ms ease-out, width 40ms ease-out, height 40ms ease-out; }
}
.tag { position: fixed; background: #111; color: #fff; padding: 3px 7px; border-radius: 4px;
  max-width: 90vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  pointer-events: none; font-size: 12px; }
.banner { position: fixed; top: 8px; left: 50%; transform: translateX(-50%);
  background: #111; color: #fff; padding: 8px 10px; border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,.4); max-width: calc(100vw - 16px);
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center;
  pointer-events: auto; text-align: center; }
.banner .keys { opacity: .8; font-size: 12px; }
.banner button { min-height: 44px; min-width: 44px; padding: 0 14px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.4); background: transparent; color: #fff;
  font: inherit; cursor: pointer; }
.banner button.primary { background: var(--accent); border-color: var(--accent);
  color: var(--badge-fill-text); font-weight: 600; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.crumbs { position: fixed; pointer-events: auto; background: #111; color: #fff;
  padding: 4px 8px; border-radius: 8px; max-width: calc(100vw - 16px); overflow-x: auto;
  white-space: nowrap; font-size: 12px; }
.crumbs button { all: unset; cursor: pointer; color: #9ecbff; padding: 4px 3px; }
.crumbs button.muted { opacity: .55; }
.crumbs button[aria-current] { text-decoration: underline; font-weight: 700; }
.crumbs .sep { opacity: .5; padding: 0 3px; }

.card { position: fixed; pointer-events: auto; width: min(560px, calc(100vw - 16px));
  max-height: 85vh; overflow: auto; background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: 0 12px 40px rgba(0,0,0,.35); }
.card[data-collapsed="true"] .card__body { display: none; }
.card__head { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
  border-bottom: 1px solid var(--border); cursor: grab; position: sticky; top: 0;
  background: var(--bg); z-index: 1; }
.card__title { font-weight: 600; flex: 1; min-width: 0; font-size: 14px;
  overflow-wrap: anywhere; }
.card__head button { min-width: 44px; min-height: 44px; }
.card__body { padding: 12px; display: grid; gap: 14px; min-width: 0; }
.sec > h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase;
  letter-spacing: .04em; color: var(--text-dim); font-weight: 600; }
.url { font-family: var(--mono); word-break: break-all; font-size: 13px;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 6px 8px; user-select: all; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.props { display: grid; grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  gap: 6px 12px; margin: 0; }
.props dt { color: var(--text-dim); min-width: 0; overflow-wrap: anywhere; }
.props dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.warn { color: var(--warn-fg); font-weight: 600; }
.poor { color: var(--poor-fg); font-weight: 600; }
.callout { border: 1px solid var(--border); border-left: 3px solid var(--accent);
  border-radius: var(--radius-sm); padding: 8px 10px; background: var(--bg-elev); }
.callout.warn { border-left-color: var(--warn); color: inherit; font-weight: 400; }
.callout.poor { border-left-color: var(--poor); color: inherit; font-weight: 400; }
.callout b { display: block; margin-bottom: 2px; }
.bars { display: grid; grid-template-columns: minmax(0, max-content) minmax(40px, 1fr) max-content;
  gap: 5px 8px; align-items: center; font-size: 12px; overflow-wrap: anywhere; }
.bars .track { background: var(--bg-elev); border-radius: 3px; height: 10px; }
.bars .fill { height: 10px; background: var(--accent); border-radius: 3px; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
caption { text-align: left; color: var(--text-dim); padding-bottom: 4px; }
th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--border);
  overflow-wrap: anywhere; }
th { color: var(--text-dim); font-weight: 600; }
tr[data-chosen="true"] { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.preview { width: 96px; height: 72px; border-radius: var(--radius-sm);
  background: var(--bg-elev); border: 1px solid var(--border); flex: none; }
button.act, a.act { display: inline-flex; align-items: center; justify-content: center;
  min-height: 44px; padding: 0 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
  font: inherit; cursor: pointer; text-decoration: none; }
button.act.primary { background: var(--accent); border-color: var(--accent);
  color: var(--badge-fill-text); font-weight: 600; }
button.act[aria-disabled="true"], a.act[aria-disabled="true"] { opacity: .5; cursor: not-allowed; }
button.hint-btn { all: unset; cursor: pointer; color: var(--accent-fg); padding: 2px 6px;
  border-radius: 4px; font-size: 12px; }
.hint { color: var(--text-dim); font-size: 12px; }
.hint-body { margin-top: 4px; font-size: 12px; color: var(--text-dim);
  border-left: 2px solid var(--border); padding-left: 8px; }
:host(*) button:focus-visible, :host(*) a:focus-visible, :host(*) [tabindex]:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
@media (max-width: 420px) {
  .card { left: 4px !important; right: 4px; top: 4px !important; transform: none !important;
    width: auto; max-height: 92vh; }
  .props { grid-template-columns: 1fr; gap: 2px 0; }
  .props dt { margin-top: 6px; }
}
`;

/* ------------------------------------------------------------------ */
/* Boot / teardown                                                     */
/* ------------------------------------------------------------------ */

async function boot(startMessage?: InspectorStartMessage): Promise<void> {
  // Idempotent (design §10.6). A second executeScript (toolbar clicked twice, or a
  // context-menu click on top of an open picker) must NOT plant a second overlay or
  // a second set of listeners — it just re-arms the existing picker.
  if ((window as unknown as Record<string, unknown>)[ACTIVE_FLAG] && overlay) {
    closeCard(overlay);
    armPicker(overlay);
    if (startMessage?.srcUrl) void tryContextMenuMatch(overlay, startMessage.srcUrl);
    return;
  }
  (window as unknown as Record<string, unknown>)[ACTIVE_FLAG] = true;

  const prefs = await loadPrefs();
  // Read the persisted UI language (English on a fresh install) and bind a
  // translator. Every string this closed-shadow card renders goes through `t`.
  const locale = await loadLocale();
  const t: TFn = (key, vars) => tAt(locale, key, vars);
  // Raise the cap again with the user's value (the default was already applied
  // synchronously at injection — see main()). The limit is published on the isolated
  // world's global so the popup's counter script reports the REAL cap instead of
  // assuming the browser default of 250.
  raiseBuffer(prefs.bufferSize);
  (window as unknown as Record<string, unknown>)[LIMIT_FLAG] = prefs.bufferSize;

  const host = h('div');
  // 🔴 CLOSED: the page cannot reach `host.shadowRoot`, so it can neither read the
  // card nor swap its contents for a spoofed one (design §9.2).
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(TOKENS + STYLES);
  root.adoptedStyleSheets = [sheet];
  applyTheme(host, prefs.theme);

  const abort = new AbortController();
  const layer = h('div', { class: 'layer' });

  const ring = h('div', { class: 'ring', attrs: { style: 'display:none' } });
  const tag = h('div', { class: 'tag', attrs: { style: 'display:none' } });
  const live = h('div', { class: 'sr', attrs: { role: 'status', 'aria-live': 'polite' } });
  const crumbs = h('div', { class: 'crumbs', attrs: { style: 'display:none' } });

  const confirm = h('button', {
    class: 'primary',
    text: t('inspectThisElement'),
    attrs: { type: 'button', style: 'display:none' },
  }) as HTMLButtonElement;
  const cancel = h('button', {
    text: t('cancel'),
    attrs: { type: 'button', 'aria-label': t('cancelPickerAria') },
  }) as HTMLButtonElement;
  const banner = h('div', { class: 'banner', attrs: { role: 'status' } }, [
    h('span', { text: t('pointAtElement') }),
    h('span', {
      class: 'keys',
      // Keys are listed for the desktop user; the two buttons are what a touch user
      // (Firefox for Android — no hover, no Esc key) actually uses.
      text: t('pickerKeys'),
    }),
    confirm,
    cancel,
  ]);

  layer.append(ring, tag, banner, crumbs, live);
  root.append(layer);
  document.documentElement.append(host);

  const prevCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'crosshair';

  const chrome: PickerChrome = { ring, tag, banner, crumbs, live, confirm, cancel };

  const state: Overlay = {
    host, root, layer, abort,
    picker: null as unknown as PickerHandle,
    chrome, card: null, cardObserver: null,
    returnFocusTo: document.activeElement,
    prefs, overflowed: false, prevCursor,
    locale, t,
  };
  overlay = state;

  // The buffer overflowed → the browser is now DROPPING NEW entries (it does NOT
  // evict old ones — design §10.5). Recording that fact is the only way to be honest
  // about a list that is silently truncated.
  window.addEventListener('resourcetimingbufferfull', () => {
    state.overflowed = true;
    (window as unknown as Record<string, unknown>)[OVERFLOW_FLAG] = true;
  }, {
    signal: abort.signal,
  });
  // The document going away takes the overlay with it; this only tidies the flag for
  // bfcache restores and SPA teardown.
  window.addEventListener('pagehide', () => teardown(), { signal: abort.signal });

  // Escape must work even when focus is somewhere in the page rather than in the
  // card (the picker's own Escape handler is inactive while a card is open). Without
  // this, a user who clicked the page after opening the card would have no keyboard
  // way out — "always escapable" has to mean always.
  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !state.card) return;
      e.preventDefault();
      closeCard(state);
      armPicker(state);
    },
    { capture: true, signal: abort.signal },
  );

  state.picker = startPicker({
    host,
    chrome,
    signal: abort.signal,
    showBreadcrumbs: prefs.showBreadcrumbs,
    autoJumpToResource: prefs.autoJumpToResource,
    t,
    onPick: (el) => openCard(state, el),
    onCancel: () => teardown(),
  });

  if (startMessage?.srcUrl) void tryContextMenuMatch(state, startMessage.srcUrl);
}

/**
 * Context-menu path (design §4.9). `contextMenus.onClicked` hands us `info.srcUrl`
 * but NOT the node — and the only way to know the node would be a persistent script
 * on every site, i.e. the "read all your data on all websites" warning we refuse to
 * pay. So we match the URL against the DOM after injection: exactly one match → open
 * the card immediately; zero or many → leave the picker armed.
 */
async function tryContextMenuMatch(state: Overlay, srcUrl: string): Promise<void> {
  const wanted = normalizeUrl(srcUrl);
  const matches: Element[] = [];
  for (const el of Array.from(document.querySelectorAll('img, video, audio, iframe'))) {
    const candidates: string[] = [];
    if (el instanceof HTMLImageElement) candidates.push(el.currentSrc, el.src);
    if (el instanceof HTMLMediaElement) candidates.push(el.currentSrc);
    if (el instanceof HTMLVideoElement && el.poster) candidates.push(el.poster);
    if (el instanceof HTMLIFrameElement) candidates.push(el.src);
    if (candidates.some((c) => c && normalizeUrl(c) === wanted)) matches.push(el);
  }
  if (matches.length === 1 && matches[0]) openCard(state, matches[0]);
}

function teardown(): void {
  const state = overlay;
  if (!state) return;
  state.abort.abort(); // one abort removes EVERY listener the picker registered
  state.cardObserver?.disconnect();
  state.host.remove();
  // Never leave the page in a state we caused: the crosshair goes back to whatever
  // the page had (usually '').
  document.documentElement.style.cursor = state.prevCursor;
  if (state.returnFocusTo instanceof HTMLElement) {
    try {
      state.returnFocusTo.focus();
    } catch {
      /* the node may be gone — not worth failing the teardown over */
    }
  }
  (window as unknown as Record<string, unknown>)[ACTIVE_FLAG] = false;
  overlay = null;
}

async function loadPrefs(): Promise<AssetsPrefs> {
  try {
    return await assetsPrefsItem.getValue();
  } catch {
    return DEFAULT_PREFS;
  }
}

/** The persisted UI locale, defaulting to English on a fresh install or if storage
 *  is unreachable (design: English default independent of the browser locale). */
async function loadLocale(): Promise<Locale> {
  try {
    return await localeItem.getValue();
  } catch {
    return 'en';
  }
}

/** Theme on the SHADOW HOST, never inherited from the page: a dark page under a
 *  light OS must not produce an unreadable card (design §11.3). */
function applyTheme(host: HTMLElement, theme: AssetsPrefs['theme']): void {
  if (theme === 'auto') host.removeAttribute('data-theme');
  else host.setAttribute('data-theme', theme);
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

function closeCard(state: Overlay): void {
  state.card?.remove();
  state.card = null;
  state.cardObserver?.disconnect();
  state.cardObserver = null;
}

/** Re-arm the picker AND put the crosshair back. The two always move together — the
 *  page must never be left wearing a cursor we chose (robustness rule). */
function armPicker(state: Overlay): void {
  document.documentElement.style.cursor = 'crosshair';
  state.picker.restart();
}

function openCard(state: Overlay, el: Element): void {
  closeCard(state);
  // The card is a thing to read and to compare against the page — the page stays
  // fully usable, so its own cursor comes back the moment picking stops.
  document.documentElement.style.cursor = state.prevCursor;
  let model: ResourceCardModel;
  try {
    model = readResourceMetadata(el, {
      overweightThreshold: state.prefs.overweightThreshold,
      buffer: bufferState(state.prefs.bufferSize, state.overflowed),
      requestScope: state.prefs.requestScope,
      measureIn: state.root,
      t: state.t,
    });
  } catch (err) {
    // Degrade honestly, never throw into the page: a cross-origin element or a
    // detached node must produce a card that says so, not a broken overlay.
    state.chrome.live.textContent = state.t('couldNotRead');
    model = failureModel(el, err, state);
  }

  const card = buildCard(state, model, el);
  state.card = card;
  state.layer.append(card);
  void restorePosition(card);

  // The element may be removed by the SPA while the card is open. We do NOT close
  // the card — the URL is still what the user came for — we mark it as a snapshot
  // (design §5.12). Scoped to the picked node's parent chain, never a global DOM
  // observer (that is the blur/adblock rule engine's job, not ours — §10.2).
  const observer = new MutationObserver(() => {
    if (!el.isConnected) {
      card.querySelector('[data-stale]')?.removeAttribute('hidden');
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  state.cardObserver = observer;

  (card.querySelector('.card__title') as HTMLElement | null)?.focus();
}

function failureModel(el: Element, err: unknown, state: Overlay): ResourceCardModel {
  return {
    kind: 'none',
    variant: 'no-resource',
    elementLabel: `<${el.tagName.toLowerCase()}>`,
    selector: '',
    currentSrc: '',
    urlOpenable: false,
    openDisabledReason: state.t('openReasonNoUrl'),
    mime: { value: '—', certainty: 'unknown' },
    weight: { kind: 'not-in-buffer' },
    initiator: { type: '—', scriptKnown: false },
    status: null,
    requests: [],
    requestsHeuristic: false,
    redirects: { kind: 'unknown' },
    buffer: bufferState(state.prefs.bufferSize, state.overflowed),
    cssRule: err instanceof Error ? state.t('couldNotReadElName', { name: err.name }) : state.t('couldNotReadEl'),
  };
}

function buildCard(state: Overlay, m: ResourceCardModel, el: Element): HTMLElement {
  const card = h('div', {
    class: 'card',
    attrs: {
      role: 'dialog',
      // NOT modal: the page stays usable, because comparing the card against the
      // element on the page is the whole point (design §11.2).
      'aria-modal': 'false',
      'aria-label': state.t('cardAria'),
      tabindex: '-1',
    },
  });

  const title = h('span', { class: 'card__title', text: state.t('cardTitle'), attrs: { tabindex: '-1' } });
  const collapse = h('button', {
    class: 'act',
    text: '⌄',
    attrs: { type: 'button', 'aria-label': state.t('collapseCard'), 'aria-expanded': 'true' },
  });
  collapse.addEventListener('click', () => {
    const collapsed = card.getAttribute('data-collapsed') === 'true';
    card.setAttribute('data-collapsed', String(!collapsed));
    collapse.setAttribute('aria-expanded', String(collapsed));
  });
  const close = h('button', {
    class: 'act',
    text: '✕',
    attrs: { type: 'button', 'aria-label': state.t('closeInspector') },
  });
  close.addEventListener('click', () => teardown());
  const head = h('div', { class: 'card__head' }, [title, collapse, close]);
  makeDraggable(card, head, state);

  const body = h('div', { class: 'card__body' });

  const stale = h('div', { class: 'callout warn', attrs: { 'data-stale': '', hidden: '', role: 'status' } }, [
    h('b', { text: state.t('staleTitle') }),
    h('span', { text: state.t('staleBody') }),
  ]);
  body.append(stale);

  if (m.buffer.overflowed || m.buffer.nearFull) body.append(bufferCallout(m, state.t));

  // Preview + identity + the one verdict this product renders.
  const headline = h('div', { class: 'row' });
  if (state.prefs.preview) headline.append(canvasPreview(el, state.t));
  headline.append(
    h('div', { attrs: { style: 'flex:1;min-width:0' } }, [
      h('div', { text: m.elementLabel }),
      h('div', { class: 'hint', text: identityLine(m, state.t) }),
    ]),
  );
  body.append(headline);

  switch (m.variant) {
    case 'mse':
      body.append(...mseSections(state, m));
      break;
    case 'iframe-cross-origin':
    case 'iframe-same-origin':
      body.append(...iframeSections(state, m));
      break;
    case 'no-resource':
      body.append(...noResourceSections(m, state.t));
      break;
    case 'data':
      body.append(...dataUriSections(state, m));
      break;
    default:
      body.append(...resourceSections(state, m));
      break;
  }

  const again = h('button', { class: 'act', text: state.t('inspectAnother'), attrs: { type: 'button' } });
  again.addEventListener('click', () => {
    closeCard(state);
    armPicker(state);
  });
  body.append(h('div', { class: 'row' }, [again, copyAsJsonButton(m, state.t)]));

  card.append(head, body);

  // Esc closes the card and re-arms the picker; the picker's own Esc exits fully.
  card.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeCard(state);
    armPicker(state);
  });

  return card;
}

function identityLine(m: ResourceCardModel, t: TFn): string {
  const parts: string[] = [];
  const kindKey: Record<string, import('../utils/i18n').MsgKey> = {
    image: 'kindImage', video: 'kindVideo', audio: 'kindAudio', iframe: 'kindFrame',
    'css-background': 'kindCssBg', none: 'kindNone',
  };
  parts.push(kindKey[m.kind] ? t(kindKey[m.kind]) : m.kind);
  if (m.mime.value !== '—') {
    parts.push(
      m.mime.certainty === 'guessed-extension'
        ? t('mimeByExt', { mime: m.mime.value })
        : m.mime.value,
    );
  }
  if (m.declaredType) parts.push(t('declaredSuffix', { type: m.declaredType }));
  if (m.failure) parts.push(t('didNotLoad'));
  return parts.join(' · ');
}

/**
 * 🔴 THE zero-network preview (design §0 И1). We draw the element the browser has
 * ALREADY decoded. We do not set an `img.src`, and we never call `toDataURL()` or
 * `toBlob()` — so a tainted canvas cannot even throw here, because there is no code
 * path that asks for the bytes. That absence is what makes "inspector, not
 * downloader" a property of the code rather than a promise in the listing.
 */
function canvasPreview(el: Element, t: TFn): HTMLElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'preview';
  canvas.width = 192;
  canvas.height = 144;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('previewAria'));
  const ctx = canvas.getContext('2d');
  try {
    if (el instanceof HTMLImageElement && el.naturalWidth > 0) {
      drawContain(ctx, el, el.naturalWidth, el.naturalHeight);
    } else if (el instanceof HTMLVideoElement && el.videoWidth > 0) {
      drawContain(ctx, el, el.videoWidth, el.videoHeight);
    } else {
      placeholder(ctx, t('previewNoFrame'));
    }
  } catch {
    // Protected (EME) content refuses to be drawn. That is an honest fact about the
    // platform, not an error in the inspector (design §4.3).
    placeholder(ctx, t('previewProtected'));
  }
  return canvas;
}

function drawContain(
  ctx: CanvasRenderingContext2D | null,
  src: CanvasImageSource,
  w: number,
  h: number,
): void {
  if (!ctx) return;
  const scale = Math.min(192 / w, 144 / h);
  const dw = Math.max(1, w * scale);
  const dh = Math.max(1, h * scale);
  ctx.drawImage(src, (192 - dw) / 2, (144 - dh) / 2, dw, dh);
}

function placeholder(ctx: CanvasRenderingContext2D | null, text: string): void {
  if (!ctx) return;
  ctx.fillStyle = 'rgba(128,128,128,.18)';
  ctx.fillRect(0, 0, 192, 144);
  ctx.fillStyle = 'rgba(128,128,128,.9)';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text.slice(0, 30), 96, 76);
}

function section(title: string, ...children: (Node | string)[]): HTMLElement {
  return h('div', { class: 'sec' }, [h('h3', { text: title }), ...children]);
}

/* ---- URL ---------------------------------------------------------- */

function urlSection(state: Overlay, m: ResourceCardModel): HTMLElement {
  const t = state.t;
  const url = h('div', { class: 'url', text: m.currentSrc || t('noUrl') });
  const copy = h('button', { class: 'act primary', text: t('copy'), attrs: { type: 'button' } });
  copy.addEventListener('click', () => {
    // Straight from the click handler: gesture + focus are present, so no
    // `clipboardWrite` permission is needed (design §4.4). One fewer manifest line.
    void copyText(m.currentSrc, copy, t('copy'), t);
  });

  const children: (Node | string)[] = [url, h('div', { class: 'row' }, [copy, openLink(m, t)])];
  children.push(
    h('div', { class: 'hint', text: t('urlActual') }),
  );
  if (m.markupSrc) {
    children.push(
      h('div', { class: 'hint', text: t('markupAsked', { src: m.markupSrc }) }),
    );
  }
  return section(t('secUrl'), ...children);
}

/** A real <a target="_blank">. Works when the service worker is dead, needs no
 *  permission, and supports middle-click for free (design §4.5). */
function openLink(m: ResourceCardModel, t: TFn): HTMLElement {
  const a = h('a', { class: 'act', text: t('openNewTab') });
  // 🔴 Protocol validated BEFORE the href is assigned. `javascript:` / `vbscript:`
  // inside a page-controlled srcset is the one genuine code-execution vector in this
  // card, and it stops right here (design §9.1).
  if (m.urlOpenable && isOpenable(m.currentSrc)) {
    a.setAttribute('href', m.currentSrc);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  } else {
    a.setAttribute('role', 'button');
    a.setAttribute('aria-disabled', 'true');
    a.setAttribute('tabindex', '0');
    if (m.openDisabledReason) a.setAttribute('title', m.openDisabledReason);
  }
  return a;
}

/* ---- Variant bodies ------------------------------------------------ */

function resourceSections(state: Overlay, m: ResourceCardModel): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (m.failure) out.push(failureCallout(m, state.t));
  if (m.variant === 'blob') out.push(blobCallout(state.t));
  out.push(urlSection(state, m));
  if (m.overweight) out.push(overweightSection(m, state.t));
  if (m.srcset && m.srcset.candidates.length > 0) out.push(srcsetSection(state, m));
  out.push(propsSection(state, m));
  out.push(requestsSection(state, m));
  out.push(redirectsSection(state, m));
  return out;
}

function failureCallout(m: ResourceCardModel, t: TFn): HTMLElement {
  return h('div', { class: 'callout poor', attrs: { role: 'status' } }, [
    h('b', {
      text: m.failure?.code
        ? t('resNotLoadCode', { code: m.failure.code })
        : t('resNotLoad'),
    }),
    h('span', { text: m.failure?.message ?? '' }),
  ]);
}

function blobCallout(t: TFn): HTMLElement {
  return h('div', { class: 'callout' }, [
    h('b', { text: t('blobTitle') }),
    h('span', { text: t('blobBody') }),
  ]);
}

function bufferCallout(m: ResourceCardModel, t: TFn): HTMLElement {
  const text = m.buffer.overflowed
    ? t('bufFull', { recorded: m.buffer.recorded, limit: m.buffer.limit })
    : t('bufNear', { recorded: m.buffer.recorded, limit: m.buffer.limit });
  return h('div', { class: 'callout warn', attrs: { role: 'status' } }, [
    h('b', { text: t('bufIncompleteTitle') }),
    h('span', { text }),
  ]);
}

function overweightSection(m: ResourceCardModel, t: TFn): HTMLElement {
  const o = m.overweight!;
  const header = h('div', {
    class: o.severity,
    text: t('overweightHeader', { ratio: o.ratio.toFixed(1) }),
  });
  const max = Math.max(o.naturalWidth, o.neededWidth, o.displayedWidth);
  const bars = h('div', { class: 'bars' });
  const bar = (label: string, px: number, unit: string): void => {
    bars.append(
      h('span', { text: label }),
      h('span', { class: 'track' }, [
        h('span', { class: 'fill', attrs: { style: `width:${Math.round((px / max) * 100)}%` } }),
      ]),
      h('span', { text: `${px} ${unit}` }),
    );
  };
  bar(t('barNatural'), o.naturalWidth, 'px');
  bar(t('barNeeded', { dpr: m.displayedSize?.dpr ?? 1 }), o.neededWidth, 'px');
  bar(t('barDisplayed'), o.displayedWidth, 'css-px');

  const wasted = 1 - o.neededWidth / o.naturalWidth;
  const why = m.srcset?.sizesMissing ? t('whyNoSizes') : t('whyGeneric');
  return section(
    t('secOverweight'),
    header,
    bars,
    // 🔴 Pixels only. We do not know the bytes (§7 №1), and a byte budget is `perf`
    // (§8). "You are wasting 340 KB" would be a lie AND a boundary violation.
    h('div', { class: 'hint', text: t('overweightWasted', { percent: formatPercent(wasted), why }) }),
  );
}

function srcsetSection(state: Overlay, m: ResourceCardModel): HTMLElement {
  const t = state.t;
  const sr = m.srcset!;
  const children: (Node | string)[] = [];

  // 🔴 We say it FIRST when our model and the browser disagree. `currentSrc` is the
  // fact; the table below is only an explanation (design §6.2).
  if (sr.modelDisagrees) {
    children.push(
      h('div', { class: 'callout warn' }, [
        h('b', { text: t('srcsetDisagreeTitle') }),
        h('span', { text: t('srcsetDisagreeBody') }),
      ]),
    );
  }

  const slotText = sr.sizesMissing
    ? t('sizesNotSet')
    : t('sizesSet', {
        sizes: sr.sizesAttr ?? '—',
        slot:
          sr.slotWidthCss === null
            ? t('slotNotComputable')
            : t('slotCssPx', { n: Math.round(sr.slotWidthCss) }),
      });
  children.push(
    h('div', { class: 'hint' }, [
      h('div', { text: t('viewportDpr', { vw: window.innerWidth, dpr: sr.dpr }) }),
      h('div', { text: slotText }),
    ]),
  );

  if (sr.sources.length > 0) children.push(sourcesTable(sr.sources, t));
  children.push(candidatesTable(sr.candidates, sr.dpr, t));
  children.push(
    h('div', { class: 'hint', text: t('srcsetDivides', { dpr: sr.dpr }) }),
  );
  children.push(
    hint(state, 'srcset-model', t('srcsetModelHint')),
  );

  const details = h('details', sr.candidates.length <= 4 || state.prefs.srcsetExpanded ? { attrs: { open: '' } } : {});
  details.append(
    h('summary', {
      text: t(sr.candidates.length === 1 ? 'srcsetSummaryOne' : 'srcsetSummaryOther', {
        n: sr.candidates.length,
      }),
    }),
    ...children.map((c) => (typeof c === 'string' ? document.createTextNode(c) : c)),
  );
  return h('div', { class: 'sec' }, [details]);
}

function sourcesTable(sources: NonNullable<ResourceCardModel['srcset']>['sources'], t: TFn): HTMLElement {
  const table = h('table');
  table.append(
    h('caption', { text: t('srcsetStage1Caption') }),
    h('thead', {}, [
      h('tr', {}, [
        h('th', { attrs: { scope: 'col' }, text: t('colType') }),
        h('th', { attrs: { scope: 'col' }, text: t('colMedia') }),
        h('th', { attrs: { scope: 'col' }, text: t('colVerdict') }),
      ]),
    ]),
  );
  const tbody = h('tbody');
  for (const s of sources) {
    const verdict = s.won
      ? t('srcWon')
      : !s.mediaMatches
        ? t('srcMediaNoMatch')
        : t('srcNotReached');
    const row = h('tr', { attrs: { 'data-chosen': String(s.won) } }, [
      h('td', { text: s.type ?? '—' }),
      h('td', { text: s.media ?? '—' }),
      h('td', { text: verdict }),
    ]);
    tbody.append(row);
  }
  table.append(tbody);
  return table;
}

function candidatesTable(candidates: SrcsetVerdict[], dpr: number, t: TFn): HTMLElement {
  const table = h('table');
  table.append(
    h('caption', { text: t('srcsetStage2Caption', { dpr }) }),
    h('thead', {}, [
      h('tr', {}, [
        h('th', { attrs: { scope: 'col' }, text: t('colCandidate') }),
        h('th', { attrs: { scope: 'col' }, text: t('colDescriptor') }),
        h('th', { attrs: { scope: 'col' }, text: t('colDensity') }),
        h('th', { attrs: { scope: 'col' }, text: t('colVerdict') }),
      ]),
    ]),
  );
  const tbody = h('tbody');
  for (const v of candidates) {
    // Never colour alone: the verdict is a symbol AND a word (WCAG 1.4.1, §11.2).
    // `v.reason` is already localized in the model (utils/srcset.ts).
    const verdict = v.chosen ? t('candChosen') : v.modelWinner ? t('candModelWould') : t('candReason', { reason: v.reason });
    tbody.append(
      h('tr', { attrs: { 'data-chosen': String(v.chosen) } }, [
        h('td', { text: fileNameOf(v.candidate.url) }),
        h('td', { text: v.candidate.descriptor }),
        h('td', { text: v.effectiveDensity === null ? '—' : `× ${v.effectiveDensity.toFixed(2)}` }),
        h('td', { class: v.chosen ? 'warn' : '', text: verdict }),
      ]),
    );
  }
  table.append(tbody);
  return table;
}

function fileNameOf(url: string): string {
  try {
    const path = new URL(url, location.href).pathname;
    return path.split('/').pop() || url;
  } catch {
    return url;
  }
}

function propsSection(state: Overlay, m: ResourceCardModel): HTMLElement {
  const t = state.t;
  const dl = h('dl', { class: 'props' });
  const add = (k: string, v: Node | string): void => {
    dl.append(h('dt', { text: k }), h('dd', {}, [typeof v === 'string' ? document.createTextNode(v) : v]));
  };

  add(
    t('propType'),
    h('span', {}, [
      document.createTextNode(m.mime.value),
      ...(m.mime.certainty === 'guessed-extension'
        ? [h('span', { class: 'hint', text: t('mimeGuessedHint') })]
        : []),
    ]),
  );
  if (m.declaredType) {
    add(t('propDeclaredFormat'), t('declaredClaimedHint', { type: m.declaredType }));
  }
  if (m.naturalSize) add(t('naturalSizeLabel'), formatDimensions(m.naturalSize.w, m.naturalSize.h));
  if (m.displayedSize) {
    const d = m.displayedSize;
    add(
      t('propDisplayed'),
      t('displayedValue', {
        disp: formatDimensions(d.w, d.h),
        dpr: d.dpr,
        dev: formatDimensions(Math.round(d.w * d.dpr), Math.round(d.h * d.dpr)),
      }),
    );
  }
  if (m.video?.duration !== undefined && m.video.duration !== null) {
    add(t('propDuration'), formatDuration(m.video.duration, t));
  }
  if (m.video?.frames) {
    add(t('frames'), t('framesValue', { rendered: m.video.frames.rendered, dropped: m.video.frames.dropped }));
  }

  // 🔴 Never a fabricated 0: an unmeasured weight is words, and the words name the
  // reason (design §7 №1, §5.4).
  const weight = h('span', {}, [document.createTextNode(formatWeight(m.weight, state.prefs.units, t))]);
  if (m.weight.kind === 'unmeasured') {
    weight.append(
      h('span', { class: 'hint', text: t('weightReasonHint', { reason: m.weight.reason }) }),
      hint(state, 'tao', t('taoHint')),
    );
  }
  add(t('weightLabel'), weight);

  add(t('propHttpStatus'), m.status === null ? t('statusNotMeasured') : String(m.status));

  if (m.attributes && Object.keys(m.attributes).length > 0) {
    add(t('propAttributes'), Object.entries(m.attributes).map(([k, v]) => `${k}=${v}`).join(' · '));
  }
  if (m.alt !== undefined) add(t('propAlt'), m.alt === '' ? t('altEmpty') : t('altValue', { alt: m.alt }));
  add(t('propSelector'), m.selector || '—');
  return section(t('secProperties'), dl);
}

function requestsSection(state: Overlay, m: ResourceCardModel): HTMLElement {
  const t = state.t;
  const list = h('div', {});
  if (m.requests.length === 0) {
    // 🔴 "0 requests" would be a lie; "no record found" is the truth, with the three
    // reasons it can happen (design §5.3, §7 №9).
    list.append(
      h('div', { class: 'hint', text: t('noReqRecord') }),
    );
  } else {
    for (const g of m.requests) {
      const count = t(g.count === 1 ? 'reqCountOne' : 'reqCountOther', { count: g.count });
      const origin = g.crossOrigin ? t('reqCrossOrigin') : t('reqSameOrigin');
      list.append(
        h('div', { class: 'row' }, [
          h('span', { text: `● ${g.host}` }),
          h('span', {
            class: 'hint',
            text: t('reqRow', { kind: g.kind, count, origin }),
          }),
        ]),
      );
    }
    list.append(
      h('div', { class: 'row' }, [
        h('span', { class: 'hint', text: t('initiatorTypeLine', { type: m.initiator.type }) }),
        hint(state, 'initiator', t('initiatorHint')),
      ]),
    );
  }
  const sec = section(
    m.requestsHeuristic ? t('secRequestsHeuristic') : t('secRequests'),
    list,
  );
  if (m.requestsHeuristic) {
    sec.append(
      h('div', { class: 'hint', text: t('requestsHeuristicNote') }),
    );
  }
  return sec;
}

function redirectsSection(state: Overlay, m: ResourceCardModel): HTMLElement {
  const t = state.t;
  // Three genuinely different facts get three different sentences (design §5.7).
  let text: string;
  switch (m.redirects.kind) {
    case 'chain':
      text = t(m.redirects.steps.length === 1 ? 'redirectStepOne' : 'redirectStepOther', {
        n: m.redirects.steps.length,
      });
      break;
    case 'occurred':
      text = t('redirectOccurred');
      break;
    case 'none':
      text = t('redirectNone');
      break;
    default:
      text = t('redirectUnknown');
  }
  return section(t('secRedirects'), h('div', { class: 'row' }, [
    h('span', { class: 'hint', text }),
    ...(m.redirects.kind === 'unknown' || m.redirects.kind === 'occurred'
      ? [hint(state, 'redirects', t('redirectHint'))]
      : []),
  ]));
}

function mseSections(state: Overlay, m: ResourceCardModel): HTMLElement[] {
  const t = state.t;
  const mse = m.mse!;
  const banner = h('div', { class: 'callout' }, [
    h('b', { text: t('mseNoUrlTitle') }),
    h('span', { text: t('mseNoUrlBody') }),
  ]);

  const dl = h('dl', { class: 'props' });
  dl.append(h('dt', { text: t('currentSrc') }), h('dd', { class: 'url', text: mse.blobUrl || t('mseNone') }));
  dl.append(h('dt', { text: t('mseMechanism') }), h('dd', { text: t('mseMechanismValue') }));
  if (mse.resolution) {
    dl.append(
      h('dt', { text: t('mseResolution') }),
      h('dd', { text: t('mseResolutionValue', { dim: formatDimensions(mse.resolution.w, mse.resolution.h) }) }),
    );
  }
  if (mse.frames) {
    dl.append(
      h('dt', { text: t('frames') }),
      h('dd', { text: t('mseFramesValue', { rendered: mse.frames.rendered, dropped: mse.frames.dropped }) }),
    );
  }
  const source = section(t('secSource'), dl);

  const drm = section(
    t('secProtection'),
    h('div', {}, [
      h('div', { text: mse.drmActive ? t('drmActive') : t('drmNone') }),
      h('div', {
        class: 'hint',
        // 🔴 We show the FACT (EME active), never a guessed system name. Naming it
        // would require hooking requestMediaKeySystemAccess() before the player
        // starts, i.e. a script on every site — a permission we do not ask for
        // (design §2.3, §7 №6). PLAN.md (Часть II) §4.4's "DRM: Widevine" is not achievable and
        // is not printed.
        text: t('drmExplain'),
      }),
    ]),
  );

  const explain = section(
    t('secWhyWorks'),
    h('div', { class: 'hint', text: t('mseWhyExplain') }),
  );

  return [banner, source, drm, requestsSection(state, m), explain];
}

function iframeSections(state: Overlay, m: ResourceCardModel): HTMLElement[] {
  const t = state.t;
  const f = m.iframe!;
  const out: HTMLElement[] = [];

  if (!f.sameOrigin) {
    // The best screen in the product: a dead end turned into a next step (design §4.8).
    out.push(
      h('div', { class: 'callout' }, [
        h('b', { text: t('iframeNoLookTitle') }),
        h('span', {
          text: t('iframeNoLookBody', {
            host: hostOf(f.src) || t('iframeAnotherOrigin'),
            page: location.hostname,
          }),
        }),
      ]),
    );
  } else {
    out.push(
      h('div', { class: 'callout' }, [
        h('b', { text: t('iframeSameTitle') }),
        h('span', { text: t('iframeSameBody') }),
      ]),
    );
  }

  out.push(urlSection(state, m));
  out.push(propsSection(state, m));
  out.push(requestsSection(state, m));
  if (!f.sameOrigin) {
    out.push(
      section(t('secWhatYouCanDo'), h('div', { class: 'hint', text: t('iframeWhatDo') })),
    );
  }
  return out;
}

function noResourceSections(m: ResourceCardModel, t: TFn): HTMLElement[] {
  const out: HTMLElement[] = [
    h('div', { class: 'callout' }, [
      h('b', { text: t('noLoadedResTitle') }),
      h('span', { text: t('noLoadedResBody', { rule: m.cssRule ?? t('aStyleRule') }) }),
    ]),
  ];
  if (m.nestedHint) {
    out.push(
      h('div', { class: 'hint', text: t('nestedResHint', { label: m.nestedHint }) }),
    );
  }
  if (m.closedShadow) {
    out.push(
      h('div', { class: 'callout warn' }, [
        h('b', { text: t('closedShadowTitle') }),
        h('span', { text: t('closedShadowBody') }),
      ]),
    );
  }
  return out;
}

function dataUriSections(state: Overlay, m: ResourceCardModel): HTMLElement[] {
  const t = state.t;
  const d = m.dataUri!;
  const out: HTMLElement[] = [
    h('div', { class: 'callout' }, [
      h('b', { text: t('dataEmbeddedTitle') }),
      h('span', { text: t('dataEmbeddedBody') }),
    ]),
  ];
  const dl = h('dl', { class: 'props' });
  dl.append(h('dt', { text: t('dataPrefix') }), h('dd', { class: 'url', text: d.prefix }));
  dl.append(h('dt', { text: t('dataLength') }), h('dd', { text: t('dataLengthValue', { n: d.length.toLocaleString() }) }));
  dl.append(h('dt', { text: t('dataHead') }), h('dd', { class: 'url', text: `${d.head}…` }));
  out.push(section(t('secEmbeddedData'), dl));
  out.push(propsSection(state, m));
  if (m.overweight) out.push(overweightSection(m, state.t));
  return out;
}

/* ---- Hints, copy, drag --------------------------------------------- */

/**
 * The ONLY form of "you'd see more in DevTools" allowed by the design: a quiet [?]
 * next to the missing value, at the moment it is missing. 🔴 No banners, no toasts,
 * no badge on the icon, no repeated nagging (design §1.3). Dismissed once → never
 * shown again (Options can bring them back).
 */
function hint(state: Overlay, id: string, text: string): HTMLElement {
  if (!state.prefs.hints || state.prefs.hintsDismissed.includes(id)) return h('span');
  const t = state.t;
  const wrap = h('span');
  const btn = h('button', {
    class: 'hint-btn',
    text: t('hintQ'),
    attrs: { type: 'button', 'aria-expanded': 'false', 'aria-label': t('hintWhyMissing') },
  });
  const body = h('div', { class: 'hint-body', attrs: { hidden: '' } }, [
    h('div', { text }),
  ]);
  const dismiss = h('button', { class: 'hint-btn', text: t('hintDontShow'), attrs: { type: 'button' } });
  dismiss.addEventListener('click', () => {
    body.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', 'false');
    const dismissed = [...state.prefs.hintsDismissed, id];
    state.prefs = { ...state.prefs, hintsDismissed: dismissed };
    void assetsPrefsItem.getValue().then((p) => assetsPrefsItem.setValue({ ...p, hintsDismissed: dismissed }));
  });
  body.append(dismiss);
  btn.addEventListener('click', () => {
    const open = body.hasAttribute('hidden');
    if (open) body.removeAttribute('hidden');
    else body.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', String(open));
  });
  wrap.append(btn, body);
  return wrap;
}

/**
 * 🔴 Export is the CLIPBOARD, always. No file is ever written: no `downloads`
 * permission, no `<a download>`, no `URL.createObjectURL` (design §0 И2). The word
 * "save" does not appear here, in an aria-label or in a tooltip — a "Save" button
 * next to a media URL is the screenshot we never want a reviewer to see.
 */
function copyAsJsonButton(m: ResourceCardModel, t: TFn): HTMLElement {
  const btn = h('button', { class: 'act', text: t('copyAsJson'), attrs: { type: 'button' } });
  btn.addEventListener('click', () => {
    const payload = {
      element: m.elementLabel,
      selector: m.selector,
      currentSrc: m.currentSrc,
      mime: m.mime,
      declaredType: m.declaredType ?? null,
      naturalSize: m.naturalSize ?? null,
      displayedSize: m.displayedSize ?? null,
      overweight: m.overweight ?? null,
      weight: m.weight,
      status: m.status,
      initiator: m.initiator,
      requests: m.requests,
      redirects: m.redirects,
      srcset: m.srcset
        ? {
            slotWidthCss: m.srcset.slotWidthCss,
            dpr: m.srcset.dpr,
            sizes: m.srcset.sizesAttr,
            candidates: m.srcset.candidates.map((c) => ({
              url: c.candidate.url,
              descriptor: c.candidate.descriptor,
              effectiveDensity: c.effectiveDensity,
              chosen: c.chosen,
              modelWinner: c.modelWinner,
            })),
            modelDisagrees: m.srcset.modelDisagrees,
          }
        : null,
    };
    void copyText(JSON.stringify(payload, null, 2), btn, t('copyAsJson'), t);
  });
  return btn;
}

async function copyText(text: string, btn: HTMLElement, restore: string, t: TFn): Promise<void> {
  const done = (label: string): void => {
    btn.textContent = label;
    setTimeout(() => { btn.textContent = restore; }, 1500);
  };
  try {
    await navigator.clipboard.writeText(text);
    done(t('copied'));
  } catch {
    // Fallback for an unfocused document / older Firefox: a textarea inside OUR
    // closed shadow root + execCommand. Deprecated, but it needs no permission and
    // never touches the page's DOM (design §4.4).
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('aria-hidden', 'true');
    btn.parentElement?.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    done(ok ? t('copied') : t('copyFailed'));
  }
}

function makeDraggable(card: HTMLElement, handle: HTMLElement, state: Overlay): void {
  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = card.getBoundingClientRect();
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent): void => {
      card.style.transform = 'none';
      card.style.left = `${clamp(rect.left + (ev.clientX - startX), 0, window.innerWidth - 60)}px`;
      card.style.top = `${clamp(rect.top + (ev.clientY - startY), 0, window.innerHeight - 40)}px`;
    };
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      // 🔴 COORDINATES ONLY. Never the URL, never the host, never anything about the
      // page (design §3, §9.3).
      const r = card.getBoundingClientRect();
      void cardPositionItem.setValue({ x: Math.round(r.left), y: Math.round(r.top) });
    };
    handle.addEventListener('pointermove', onMove, { signal: state.abort.signal });
    handle.addEventListener('pointerup', onUp, { signal: state.abort.signal });
  }, { signal: state.abort.signal });
}

async function restorePosition(card: HTMLElement): Promise<void> {
  Object.assign(card.style, { left: '50%', top: '8vh', transform: 'translateX(-50%)' });
  try {
    const pos = await cardPositionItem.getValue();
    if (!pos) return;
    Object.assign(card.style, {
      left: `${clamp(pos.x, 0, window.innerWidth - 60)}px`,
      top: `${clamp(pos.y, 0, window.innerHeight - 40)}px`,
      transform: 'none',
    });
  } catch {
    /* keep the centred default */
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export default defineContentScript({
  // 🔴 registration:'runtime' → NOT in the manifest's content_scripts, NOT injected
  // on any page automatically. The background injects it on a user gesture under
  // activeTab. That is what buys us a permission set with no install warning
  // (design §1.4, §13 №7).
  matches: ['*://*/*'],
  registration: 'runtime',
  runAt: 'document_idle',
  main() {
    // Raise the Resource Timing cap FIRST, before any UI (design §4.1 step 3). The
    // default is applied synchronously; boot() re-applies the user's pref once
    // storage answers. ⚠️ This can only help FUTURE requests: an overflowed buffer
    // has already thrown the late entries away, and nothing brings them back.
    raiseBuffer(DEFAULT_PREFS.bufferSize);

    // ⚠️ main() runs again on EVERY executeScript. Registering the message listener
    // unguarded would add a second, third, fourth… listener on every toolbar click —
    // the classic re-injection leak. One flag, set once per document, and it is
    // deliberately NOT the same flag as ACTIVE_FLAG (which is cleared on teardown).
    const globals = window as unknown as Record<string, unknown>;
    if (!globals[LISTENER_FLAG]) {
      globals[LISTENER_FLAG] = true;
      browser.runtime.onMessage.addListener((msg: InspectorStartMessage) => {
        if (msg?.type === 'assets:start') void boot(msg);
      });
    }
    void boot();
  },
});
