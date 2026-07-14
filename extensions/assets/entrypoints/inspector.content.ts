import { defineContentScript, browser } from '#imports';
import type { ResourceCardModel, SrcsetVerdict } from '../utils/assets-types';
import { inspectElement } from '../utils/inspect';
import { formatDimensions, formatWeight, formatPercent, hostOf } from '../utils/format';

// The injected inspector overlay — 🥇 THE CORE PRODUCT SURFACE (design §0 И3, §2).
//
// Why it lives in the page and not a popup: the popup DIES on the first page click,
// so "open popup → click element → read result in popup" is physically impossible.
// The result here is a SCREEN to read and compare against the page, so it must be
// an in-page overlay. It renders inside a CLOSED shadow root so a hostile page can
// neither restyle it nor read it (design §9.2).
//
// This is `registration: 'runtime'`: it is NOT auto-injected on any page. The
// background injects it via scripting.executeScript on a user gesture (activeTab).
//
// 🔴 INVARIANTS enforced structurally in this file:
//   - ZERO network. No fetch/XHR/img.src/video.src of any shown URL. The preview
//     is `canvas.drawImage(theExistingElement)` — the browser already loaded it,
//     so the preview costs zero requests (design §0 И1). We never call
//     toDataURL/toBlob — there is no path to the bytes, so no download exists.
//   - ZERO innerHTML. Every node is built with createElement + textContent; the
//     whole card is page-controlled data (alt, URL, srcset) and must never be
//     parsed as HTML (design §9.1).
//   - Styles via a static constructed CSSStyleSheet + adoptedStyleSheets — never a
//     template string with an interpolated URL (CSS injection, design §9.1).
//   - "Open in new tab" is a real <a>, and its href is set ONLY after validating
//     protocol ∈ {http,https}; blob:/data:/MSE disable the button (design §4.5, §9.1).
//
// The DOM/Resource-Timing reading is STUBBED (utils/inspect.ts returns mock models
// with mock:true → a MockBadge renders). The picker interaction shell, the closed
// shadow root, the canvas preview and the whole card layout are REAL.

const ACTIVE_FLAG = '__assetsInspectorActive';

interface OverlayState {
  root: ShadowRoot;
  host: HTMLElement;
  abort: AbortController;
  ring: HTMLElement;
  label: HTMLElement;
  banner: HTMLElement;
  status: HTMLElement;
  crumbs: HTMLElement;
  current: Element | null;
  stackIndex: number;
  pointer: { x: number; y: number };
  returnFocusTo: Element | null;
  card: HTMLElement | null;
}

/** A tiny typed createElement helper. Text is set via textContent — never HTML. */
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

/** Whether an element currently carries a loaded resource (for the `R` key + crumbs). */
function hasResource(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'img' && (el as HTMLImageElement).currentSrc) return true;
  if ((tag === 'video' || tag === 'audio') && (el as HTMLMediaElement).currentSrc) return true;
  if (tag === 'video' && (el as HTMLVideoElement).poster) return true;
  if (tag === 'iframe') return true;
  const bg = getComputedStyle(el).backgroundImage;
  return bg !== 'none' && bg.includes('url(');
}

/** A short human label for an element: `tag.class` (+ resource marker). */
function elementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = el.classList[0] ? `.${el.classList[0]}` : '';
  return `${tag}${cls}`;
}

const STYLES = `
:host { all: initial; }
.layer { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
  font: 13px/1.5 system-ui, sans-serif; color-scheme: light dark; }
.ring { position: fixed; box-sizing: border-box; border: 2px solid #1d6fff;
  outline: 1px solid rgba(0,0,0,.55); box-shadow: 0 0 0 1px #fff; border-radius: 2px;
  pointer-events: none; }
@media (prefers-reduced-motion: no-preference) { .ring { transition: all 40ms ease-out; } }
.tag { position: fixed; background: #111; color: #fff; padding: 2px 6px;
  border-radius: 3px; max-width: 90vw; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; pointer-events: none; }
.banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
  background: #111; color: #fff; padding: 8px 14px; border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,.4); max-width: 92vw; text-align: center;
  pointer-events: none; }
.banner small { display: block; opacity: .8; margin-top: 3px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.crumbs { position: fixed; pointer-events: auto; background: #111; color: #fff;
  padding: 4px 8px; border-radius: 6px; max-width: 92vw; overflow-x: auto;
  white-space: nowrap; }
.crumbs button { all: unset; cursor: pointer; color: #9ecbff; padding: 0 2px; }
.crumbs .muted { opacity: .5; }
.crumbs .sep { opacity: .5; padding: 0 2px; }

.card { position: fixed; pointer-events: auto; width: min(560px, 92vw);
  max-height: 84vh; overflow: auto; background: Canvas; color: CanvasText;
  border: 1px solid rgba(128,128,128,.4); border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.35); }
.card__head { display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  border-bottom: 1px solid rgba(128,128,128,.25); cursor: grab; position: sticky;
  top: 0; background: Canvas; }
.card__title { font-weight: 600; flex: 1; }
.card__body { padding: 12px; display: grid; gap: 14px; }
.mock { background: #7a5b00; color: #fff; font-size: 12px; padding: 4px 8px;
  border-radius: 6px; }
.sec h3 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase;
  letter-spacing: .04em; opacity: .7; }
.url { font-family: ui-monospace, monospace; word-break: break-all; font-size: 13px; }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.props { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; }
.props dt { opacity: .7; } .props dd { margin: 0; }
.warn { color: #a15c00; font-weight: 600; }
.poor { color: #b3261e; font-weight: 600; }
.callout { border: 1px solid rgba(128,128,128,.4); border-radius: 8px; padding: 8px 10px; }
.bar { display: grid; grid-template-columns: max-content 1fr max-content; gap: 6px 8px;
  align-items: center; }
.bar .fill { height: 10px; background: #1d6fff; border-radius: 3px; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid rgba(128,128,128,.25); }
.preview { width: 96px; height: 72px; object-fit: contain; border-radius: 6px;
  background: rgba(128,128,128,.15); flex: none; }
button.act { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 6px;
  border: 1px solid rgba(128,128,128,.5); }
button.act[aria-disabled="true"] { opacity: .5; cursor: not-allowed; }
a.act { text-decoration: none; }
.hint { opacity: .7; font-size: 12px; }
`;

let state: OverlayState | null = null;

function boot(): void {
  // Idempotent (design §10.6): a second injection just restarts the picker.
  if ((window as unknown as Record<string, unknown>)[ACTIVE_FLAG]) {
    if (state) startPicker(state);
    return;
  }
  (window as unknown as Record<string, unknown>)[ACTIVE_FLAG] = true;

  const host = h('div');
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLES);
  root.adoptedStyleSheets = [sheet];

  const abort = new AbortController();
  const layer = h('div', { class: 'layer' });
  const ring = h('div', { class: 'ring', attrs: { style: 'display:none' } });
  const label = h('div', { class: 'tag', attrs: { style: 'display:none' } });
  const banner = h('div', { class: 'banner', attrs: { role: 'status' } });
  banner.append(
    document.createTextNode('Hover an element · Enter to inspect · Esc to cancel'),
    h('small', { text: '↑ parent  ↓ child  ← → siblings  [ ] stack under cursor  R nearest resource' }),
  );
  const status = h('div', { class: 'sr', attrs: { role: 'status', 'aria-live': 'polite' } });
  const crumbs = h('div', { class: 'crumbs', attrs: { style: 'display:none' } });
  layer.append(ring, label, banner, status, crumbs);
  root.append(layer);
  document.documentElement.append(host);

  state = {
    root, host, abort, ring, label, banner, status, crumbs,
    current: null, stackIndex: 0, pointer: { x: 0, y: 0 },
    returnFocusTo: document.activeElement, card: null,
  };

  attachPickerListeners(state);
  startPicker(state);
}

function attachPickerListeners(s: OverlayState): void {
  const { signal } = s.abort;
  document.addEventListener(
    'mousemove',
    (e: MouseEvent) => {
      if (s.card) return; // picking is paused while the card is open
      s.pointer = { x: e.clientX, y: e.clientY };
      const path = e.composedPath();
      // composedPath()[0] pierces OPEN shadow DOM — event.target would only see the
      // host (the adblock picker's blind spot, design §2.1). Skip our own overlay.
      const target = path.find((n) => n instanceof Element && n !== s.host) as Element | undefined;
      if (target) setCurrent(s, target);
    },
    { capture: true, signal },
  );
  document.addEventListener(
    'click',
    (e: MouseEvent) => {
      if (s.card) return;
      e.preventDefault();
      e.stopPropagation();
      if (s.current) pick(s, s.current);
    },
    { capture: true, signal },
  );
  document.addEventListener('keydown', (e: KeyboardEvent) => onKey(s, e), { capture: true, signal });
}

function startPicker(s: OverlayState): void {
  s.card?.remove();
  s.card = null;
  s.banner.style.display = '';
  s.crumbs.style.display = '';
  // Keyboard entry target: the focused element, else the current one.
  const start = (document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : s.current) as Element | null;
  if (start) setCurrent(s, start);
}

function setCurrent(s: OverlayState, el: Element): void {
  s.current = el;
  place(s, el);
  renderCrumbs(s, el);
  announce(s, el);
}

function place(s: OverlayState, el: Element): void {
  const r = el.getBoundingClientRect();
  Object.assign(s.ring.style, {
    display: '', left: `${r.left}px`, top: `${r.top}px`,
    width: `${r.width}px`, height: `${r.height}px`,
  });
  const res = hasResource(el) ? ' · 🎬 resource' : '';
  s.label.textContent = `${elementLabel(el)} · ${Math.round(r.width)}×${Math.round(r.height)}${res}`;
  Object.assign(s.label.style, {
    display: '', left: `${Math.max(0, r.left)}px`, top: `${Math.max(0, r.top - 22)}px`,
  });
}

function renderCrumbs(s: OverlayState, el: Element): void {
  s.crumbs.replaceChildren();
  const chain: Element[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < 6) {
    chain.unshift(node);
    node = node.parentElement;
    depth += 1;
  }
  chain.forEach((node, i) => {
    if (i > 0) s.crumbs.append(h('span', { class: 'sep', text: '›' }));
    const btn = h('button', { text: elementLabel(node) + (hasResource(node) ? ' 🎬' : '') });
    if (!hasResource(node)) btn.classList.add('muted');
    btn.addEventListener('click', () => setCurrent(s, node));
    s.crumbs.append(btn);
  });
  const r = el.getBoundingClientRect();
  Object.assign(s.crumbs.style, { left: `${Math.max(4, r.left)}px`, top: `${Math.max(40, r.top - 52)}px` });
}

function announce(s: OverlayState, el: Element): void {
  const r = el.getBoundingClientRect();
  s.status.textContent = `${elementLabel(el)}, ${Math.round(r.width)} by ${Math.round(r.height)}${
    hasResource(el) ? ', has resource' : ', no resource'
  }`;
}

function onKey(s: OverlayState, e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (s.card) startPicker(s);
    else teardown();
    return;
  }
  if (s.card) return; // inside the card, Tab/arrows behave normally (design §11.1)
  const cur = s.current;
  if (!cur) return;
  const move = (next: Element | null | undefined): void => {
    if (next) { e.preventDefault(); setCurrent(s, next); }
  };
  switch (e.key) {
    case 'ArrowUp': move(cur.parentElement); break;
    case 'ArrowDown': move(cur.firstElementChild); break;
    case 'ArrowLeft': move(cur.previousElementSibling); break;
    case 'ArrowRight': move(cur.nextElementSibling); break;
    case '[':
    case ']': {
      const stack = document.elementsFromPoint(s.pointer.x, s.pointer.y).filter((n) => n !== s.host);
      if (stack.length === 0) break;
      s.stackIndex = (s.stackIndex + (e.key === ']' ? 1 : -1) + stack.length) % stack.length;
      move(stack[s.stackIndex]);
      break;
    }
    case 'r':
    case 'R': move(nearestResource(cur)); break;
    case 'Enter':
    case ' ': e.preventDefault(); pick(s, cur); break;
  }
}

/** Walk up then down (bounded) to the first element carrying a resource (§10.3). */
function nearestResource(el: Element): Element | null {
  let up: Element | null = el;
  for (let i = 0; up && i < 20; i += 1) { if (hasResource(up)) return up; up = up.parentElement; }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  for (let i = 0; node && i < 200; i += 1) {
    if (node instanceof Element && hasResource(node)) return node;
    node = walker.nextNode();
  }
  return null;
}

function pick(s: OverlayState, el: Element): void {
  s.banner.style.display = 'none';
  s.crumbs.style.display = 'none';
  s.ring.style.display = 'none';
  s.label.style.display = 'none';
  const model = inspectElement(el); // STUB → mock model (design §4.1 real reader is TODO_LOGIC)
  s.card = buildCard(s, model, el);
  s.root.querySelector('.layer')?.append(s.card);
  // Focus the card title (dialog focus, design §11.2).
  (s.card.querySelector('.card__title') as HTMLElement | null)?.focus();
}

function teardown(): void {
  if (!state) return;
  state.abort.abort();
  state.host.remove();
  const back = state.returnFocusTo;
  if (back instanceof HTMLElement) back.focus();
  (window as unknown as Record<string, unknown>)[ACTIVE_FLAG] = false;
  state = null;
}

/* ------------------------------------------------------------------ */
/* Resource card                                                       */
/* ------------------------------------------------------------------ */

function buildCard(s: OverlayState, m: ResourceCardModel, el: Element): HTMLElement {
  const card = h('div', { class: 'card', attrs: { role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Asset Inspector' } });

  const title = h('span', { class: 'card__title', text: 'Asset Inspector', attrs: { tabindex: '-1' } });
  const closeBtn = h('button', { class: 'act', text: '✕', attrs: { 'aria-label': 'Close inspector' } });
  closeBtn.addEventListener('click', () => teardown());
  const head = h('div', { class: 'card__head' }, [title, closeBtn]);
  makeDraggable(card, head);

  const body = h('div', { class: 'card__body' });
  if (m.mock) body.append(h('div', { class: 'mock', attrs: { 'data-mock': 'true', role: 'note' }, text: 'Demo data — logic not wired yet (scaffold).' }));

  // Preview + element label + verdict
  const previewWrap = h('div', { class: 'row' });
  previewWrap.append(canvasPreview(el), h('div', {}, [h('div', { text: m.elementLabel }), verdictLine(m)]));
  body.append(previewWrap);

  // Variant-specific body
  switch (m.variant) {
    case 'image': body.append(...imageSections(m)); break;
    case 'mse': body.append(...mseSections(m)); break;
    case 'iframe-cross-origin': body.append(...iframeSections(m)); break;
    case 'no-resource': body.append(...noResourceSections(m)); break;
    default: body.append(...imageSections(m)); // blob/data/progressive/failed reuse the same builders
  }

  // Footer
  const again = h('button', { class: 'act', text: 'Inspect another element' });
  again.addEventListener('click', () => startPicker(s));
  body.append(h('div', { class: 'row' }, [again, copyAsButton(m)]));

  card.append(head, body);
  // Restore centred (position persistence is a stubbed pref — coords only, design §3).
  Object.assign(card.style, { left: '50%', top: '10vh', transform: 'translateX(-50%)' });
  return card;
}

/** Real, zero-network preview: draw the ALREADY-LOADED element onto a canvas.
 *  Never toDataURL/toBlob — there is no path to the bytes (design §0 И1). */
function canvasPreview(el: Element): HTMLElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'preview';
  canvas.width = 96; canvas.height = 72;
  const ctx = canvas.getContext('2d');
  try {
    if (el instanceof HTMLImageElement && el.naturalWidth > 0) ctx?.drawImage(el, 0, 0, 96, 72);
    else if (el instanceof HTMLVideoElement && el.videoWidth > 0) ctx?.drawImage(el, 0, 0, 96, 72);
    else drawPlaceholder(ctx);
  } catch {
    // Tainted/DRM canvas throws on draw for protected content — an honest fact,
    // not an error (design §4.3). We never called toDataURL, so no SecurityError
    // path to the bytes exists; show a placeholder frame.
    drawPlaceholder(ctx);
  }
  return canvas;
}

function drawPlaceholder(ctx: CanvasRenderingContext2D | null): void {
  if (!ctx) return;
  ctx.fillStyle = 'rgba(128,128,128,.2)';
  ctx.fillRect(0, 0, 96, 72);
  ctx.fillStyle = 'rgba(128,128,128,.8)';
  ctx.font = '10px system-ui';
  ctx.fillText('no frame', 24, 40);
}

function verdictLine(m: ResourceCardModel): HTMLElement {
  const parts: string[] = [];
  if (m.kind === 'image') parts.push('Image');
  if (m.mime.value !== '—') parts.push(`${m.mime.value}${m.mime.certainty === 'guessed-extension' ? ' (by extension)' : ''}`);
  const line = h('div', { class: 'hint', text: parts.join(' · ') });
  return line;
}

function section(title: string, ...children: (Node | string)[]): HTMLElement {
  return h('div', { class: 'sec' }, [h('h3', { text: title }), ...children]);
}

function urlSection(m: ResourceCardModel): HTMLElement {
  const url = h('div', { class: 'url', text: m.currentSrc || '(none)' });
  const copy = h('button', { class: 'act', text: 'Copy' });
  copy.addEventListener('click', () => {
    // Direct clipboard write in the click handler (gesture + focus present, design
    // §4.4). No clipboardWrite permission needed.
    void navigator.clipboard.writeText(m.currentSrc).then(
      () => { copy.textContent = 'Copied ✓'; setTimeout(() => (copy.textContent = 'Copy'), 1500); },
      () => { copy.textContent = 'Copy failed'; },
    );
  });
  const open = openLink(m);
  return section('URL — what the browser actually loaded (currentSrc)', url, h('div', { class: 'row' }, [copy, open]));
}

/** A REAL <a> for "open in new tab", href set only after protocol validation. */
function openLink(m: ResourceCardModel): HTMLElement {
  const a = h('a', { class: 'act', text: 'Open ↗' });
  let ok = m.urlOpenable;
  try {
    const proto = new URL(m.currentSrc).protocol;
    if (proto !== 'http:' && proto !== 'https:') ok = false; // blocks javascript:/blob:/data: (design §9.1)
  } catch {
    ok = false;
  }
  if (ok) {
    a.setAttribute('href', m.currentSrc);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  } else {
    a.setAttribute('aria-disabled', 'true');
    a.setAttribute('role', 'button');
    if (m.openDisabledReason) a.setAttribute('title', m.openDisabledReason);
  }
  return a;
}

function imageSections(m: ResourceCardModel): HTMLElement[] {
  const out: HTMLElement[] = [urlSection(m)];
  if (m.overweight) out.push(overweightSection(m.overweight));
  if (m.srcset) out.push(srcsetSection(m.srcset));
  out.push(propsSection(m));
  out.push(requestsSection(m));
  out.push(redirectsSection(m));
  return out;
}

function overweightSection(o: NonNullable<ResourceCardModel['overweight']>): HTMLElement {
  const cls = o.severity;
  const header = h('div', { class: cls, text: `⚠️ OVERWEIGHT ${o.ratio.toFixed(1)}×` });
  const bar = (label: string, px: number, max: number): HTMLElement =>
    h('div', { class: 'bar' }, [
      h('span', { text: label }),
      h('span', {}, [h('span', { class: 'fill', attrs: { style: `width:${Math.round((px / max) * 100)}%` } })]),
      h('span', { text: `${px} px` }),
    ]);
  const max = o.naturalWidth;
  return section(
    'Overweight',
    header,
    bar('natural', o.naturalWidth, max),
    bar(`needed (DPR)`, o.neededWidth, max),
    bar('displayed', o.displayedWidth, max),
    h('div', { class: 'hint', text: `Wasted pixels: ${formatPercent(1 - o.neededWidth / o.naturalWidth)} at the current window size.` }),
  );
}

function srcsetSection(sr: NonNullable<ResourceCardModel['srcset']>): HTMLElement {
  const table = h('table');
  table.append(
    h('caption', { class: 'sr', text: 'srcset candidates and why the browser chose one' }),
    h('thead', {}, [
      h('tr', {}, [
        h('th', { attrs: { scope: 'col' }, text: 'Candidate' }),
        h('th', { attrs: { scope: 'col' }, text: 'Descriptor' }),
        h('th', { attrs: { scope: 'col' }, text: 'Density' }),
        h('th', { attrs: { scope: 'col' }, text: 'Verdict' }),
      ]),
    ]),
  );
  const tbody = h('tbody');
  for (const v of sr.candidates) tbody.append(candidateRow(v));
  table.append(tbody);

  const children: (Node | string)[] = [];
  if (sr.modelDisagrees) {
    children.push(h('div', { class: 'callout warn' }, [
      h('div', { text: '⚠️ The browser loaded a different file than the rule predicts.' }),
      h('div', { class: 'hint', text: 'The fact (currentSrc) is marked ✔ above. Our recomputation is only an explanation — cache or Data Saver can override it.' }),
    ]));
  }
  const ctx = h('div', { class: 'hint', text:
    `Slot: ${sr.slotWidthCss ?? '—'} css-px · DPR ${sr.dpr}${sr.sizesAttr ? ` · sizes="${sr.sizesAttr}"` : ' · no sizes → slot = 100vw'}` });
  return section(`What the browser chose from srcset — ${sr.candidates.length} candidates`, ctx, table, ...children);
}

function candidateRow(v: SrcsetVerdict): HTMLElement {
  const mark = v.chosen ? '✔ CHOSEN' : v.modelWinner ? '● model pick' : v.reason;
  const name = v.candidate.url.split('/').pop() ?? v.candidate.url;
  const row = h('tr', {}, [
    h('td', { text: name }),
    h('td', { text: v.candidate.descriptor }),
    h('td', { text: v.effectiveDensity === null ? '—' : `× ${v.effectiveDensity.toFixed(2)}` }),
    h('td', { class: v.chosen ? 'warn' : '', text: mark }),
  ]);
  return row;
}

function propsSection(m: ResourceCardModel): HTMLElement {
  const dl = h('dl', { class: 'props' });
  const add = (k: string, v: Node | string): void => { dl.append(h('dt', { text: k }), h('dd', {}, [typeof v === 'string' ? document.createTextNode(v) : v]) ); };
  add('Type', h('span', {}, [
    document.createTextNode(m.mime.value),
    m.mime.certainty === 'guessed-extension' ? h('span', { class: 'hint', text: '  ⓘ by file extension' }) : document.createTextNode(''),
  ]));
  if (m.naturalSize) add('Natural', formatDimensions(m.naturalSize.w, m.naturalSize.h));
  if (m.displayedSize) add('Displayed', `${formatDimensions(m.displayedSize.w, m.displayedSize.h)} css-px · DPR ${m.displayedSize.dpr}`);
  add('Weight', weightValue(m));
  if (m.attributes) add('Attributes', Object.entries(m.attributes).map(([k, v]) => `${k}=${v}`).join(' · '));
  if (m.alt !== undefined) add('alt', `«${m.alt}»`);
  return section('Properties', dl);
}

function weightValue(m: ResourceCardModel): HTMLElement {
  const span = h('span', {}, [document.createTextNode(formatWeight(m.weight))]);
  if (m.weight.kind === 'unmeasured') span.append(h('span', { class: 'hint', text: `  ⓘ ${m.weight.reason} [?]` }));
  return span;
}

function requestsSection(m: ResourceCardModel): HTMLElement {
  const list = h('div', {});
  if (m.requests.length === 0) {
    list.append(h('div', { class: 'hint', text: 'No request record found (may be cache, cleared timings, or a full buffer).' }));
  } else {
    for (const g of m.requests) {
      list.append(h('div', { class: 'row' }, [
        h('span', { text: `● ${g.host}` }),
        h('span', { class: 'hint', text: `${g.kind} · ${g.count} request${g.count === 1 ? '' : 's'}${g.crossOrigin ? ' · cross-origin' : ''}` }),
      ]));
    }
    list.append(h('div', { class: 'hint', text: `initiator type: ${m.initiator.type} · which script — only in DevTools [?]` }));
  }
  const title = `Requests that loaded it${m.requestsHeuristic ? ' · heuristic ⓘ' : ''}`;
  const sec = section(title, list);
  if (m.requestsHeuristic) sec.append(h('div', { class: 'hint', text: 'Matched by type + host, not by fact. Two players on one page cannot be told apart — exact attribution needs the DevTools panel. [?]' }));
  return sec;
}

function redirectsSection(m: ResourceCardModel): HTMLElement {
  let text: string;
  if (m.redirects.kind === 'chain') text = `${m.redirects.steps.length} steps (see DevTools panel)`;
  else if (m.redirects.kind === 'occurred') text = 'A redirect happened — intermediate URLs only in the DevTools panel. [?]';
  else text = 'unknown — cross-origin without Timing-Allow-Origin. Chain visible only in the DevTools panel. [?]';
  return section('Redirects', h('div', { class: 'hint', text }));
}

function mseSections(m: ResourceCardModel): HTMLElement[] {
  const mse = m.mse!;
  const banner = h('div', { class: 'callout' }, [
    h('div', { text: 'This video has NO direct URL.' }),
    h('div', { class: 'hint', text: 'The player assembles it from in-memory segments (MSE). blob: is a pointer to RAM, not a file — there is nothing to open.' }),
  ]);
  const source = section('Source',
    (() => { const dl = h('dl', { class: 'props' });
      dl.append(h('dt', { text: 'currentSrc' }), h('dd', { class: 'url', text: mse.blobUrl }));
      dl.append(h('dt', { text: 'Mechanism' }), h('dd', { text: 'Media Source Extensions (MSE)' }));
      if (mse.resolution) dl.append(h('dt', { text: 'Resolution' }), h('dd', { text: `${formatDimensions(mse.resolution.w, mse.resolution.h)} (current quality)` }));
      if (mse.frames) dl.append(h('dt', { text: 'Frames' }), h('dd', { text: `${mse.frames.rendered} rendered · ${mse.frames.dropped} dropped ⓘ` }));
      return dl; })(),
  );
  const drm = section('Content protection', h('div', {}, [
    h('div', { text: mse.drmActive ? 'DRM detected: EME active (video.mediaKeys ≠ null)' : 'No EME detected' }),
    h('div', { class: 'hint', text: 'Decryption runs in the browser’s CDM binary — no extension or other JS sees decrypted frames. The system name (Widevine/PlayReady/FairPlay) is NOT shown: knowing it needs a script on every site before the player starts, which we do not request.' }),
  ]));
  const explain = section('Why it works this way', h('div', { class: 'hint', text: 'Streaming is thousands of small segments instead of one file, so quality can adapt on the fly. This is how the platform is built — not a limit of the inspector.' }));
  return [banner, source, drm, requestsSection(m), explain];
}

function iframeSections(m: ResourceCardModel): HTMLElement[] {
  const f = m.iframe!;
  const banner = h('div', { class: 'callout' }, [
    h('div', { text: 'We do not look inside this frame.' }),
    h('div', { class: 'hint', text: `It is loaded from ${hostOf(f.src)}, a different origin than the page. The browser isolates other origins — neither an extension nor the page’s own scripts can see its contents. This is protection, not breakage.` }),
  ]);
  const dl = h('dl', { class: 'props' });
  dl.append(h('dt', { text: 'Frame URL' }), h('dd', { class: 'url', text: f.src }));
  dl.append(h('dt', { text: 'Size' }), h('dd', { text: `${formatDimensions(f.size.w, f.size.h)} css-px` }));
  for (const [k, v] of Object.entries(f.attributes)) dl.append(h('dt', { text: k }), h('dd', { text: v }));
  const next = section('What you can do', h('div', { class: 'hint', text: 'Open the frame URL in a new tab (↗ above) — there it becomes an ordinary page and the inspector works as everywhere.' }));
  return [banner, urlSection(m), dl, next];
}

function noResourceSections(m: ResourceCardModel): HTMLElement[] {
  const banner = h('div', { class: 'callout' }, [
    h('div', { text: 'This element has NO loaded resource.' }),
    h('div', { class: 'hint', text: `It is painted by CSS: ${m.cssRule ?? 'a style rule'} — code in the stylesheet, not a file.` }),
  ]);
  return [banner, requestsSection(m)];
}

/** "Copy as JSON / Markdown" — clipboard ONLY. 🔴 Never a file (design §0 И2). */
function copyAsButton(m: ResourceCardModel): HTMLElement {
  const btn = h('button', { class: 'act', text: 'Copy as JSON ⌄' });
  btn.addEventListener('click', () => {
    const json = JSON.stringify(
      { elementLabel: m.elementLabel, currentSrc: m.currentSrc, mime: m.mime, weight: m.weight },
      null, 2,
    );
    void navigator.clipboard.writeText(json).then(
      () => { btn.textContent = 'Copied ✓'; setTimeout(() => (btn.textContent = 'Copy as JSON ⌄'), 1500); },
      () => { btn.textContent = 'Copy failed'; },
    );
  });
  return btn;
}

function makeDraggable(card: HTMLElement, handle: HTMLElement): void {
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    const startX = e.clientX; const startY = e.clientY;
    const rect = card.getBoundingClientRect();
    const onMove = (ev: MouseEvent): void => {
      card.style.transform = 'none';
      card.style.left = `${rect.left + (ev.clientX - startX)}px`;
      card.style.top = `${rect.top + (ev.clientY - startY)}px`;
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // TODO_LOGIC: persist cardPosition (coords only) via cardPositionItem.
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

export default defineContentScript({
  // 🔴 registration:'runtime' → NOT in the manifest, NOT auto-injected on any page.
  // The background injects this on a user gesture under activeTab (design §1.4, §13
  // №7). matches is required by the type but is inert for runtime registration.
  matches: ['*://*/*'],
  registration: 'runtime',
  runAt: 'document_idle',
  main() {
    // Raise the Resource Timing buffer FIRST, before any UI, so later requests are
    // at least recorded (design §4.1 step 3, §10.5). Effect is on the next load.
    try {
      performance.setResourceTimingBufferSize(1500);
    } catch {
      // Not available / already large — harmless.
    }
    // Start on inject, and also on the background's assets:start message (carries
    // the context-menu srcUrl). ONLY the picked URL ever leaves the page, and only
    // on user action (design §9.3).
    browser.runtime.onMessage.addListener((msg: { type?: string }) => {
      if (msg?.type === 'assets:start') boot();
    });
    boot();
  },
});
