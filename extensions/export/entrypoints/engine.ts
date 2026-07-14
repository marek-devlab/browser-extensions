import { defineUnlistedScript } from '#imports';
import { MOCK_INVENTORY } from '../utils/mock-data';
import type { TableModel } from '../utils/types';

// `engine.js` — injected ON A GESTURE by the background via
// scripting.executeScript under `activeTab` (design §0). NEVER a persistent
// content script. It is idempotent (§9.5): a second injection focuses the
// existing overlay instead of creating a second one.
//
// SCAFFOLD STATUS:
//  - REAL: the closed-shadow-root overlay, the KEYBOARD-operable picker (roving
//    tabindex, Tab / 1-9 / ↑↓ / Enter / Esc, capture-phase listeners, aria-live),
//    focus management, and the "no innerHTML" construction (createElement +
//    textContent only — design §8.1). It renders the MOCK candidate list.
//  - MOCKED: the real table scan/scoring (utils/table-extract.ts) and what happens
//    on confirm (mount the preview dialog on-page) — both throw/return TODO_LOGIC.
//
// This module improves on adblock's element-picker (mouse-only, `e.target`): it is
// keyboard-first and would use `composedPath()` for shadow-correct targeting.

const MARKER = 'data-blur-export-overlay';

export default defineUnlistedScript(() => {
  // Idempotency (§9.5): focus the existing overlay on a repeat injection.
  const existing = document.documentElement.querySelector(`[${MARKER}]`);
  if (existing) {
    (existing as HTMLElement).focus?.();
    return;
  }

  // TODO_LOGIC: replace the mock candidates with a real scan
  // (deepQuerySelectorAll('table') from @blur/core + scoring, design §4.2).
  const candidates = MOCK_INVENTORY.tables;

  // Closed shadow root on <html> so the page's CSS can't repaint the overlay and
  // our styles can't disturb the page's :nth-child (design §2.2 / §10.2). `:host {
  // all: initial }` isolates inherited styles (pattern from blur/label-overlay).
  const hostEl = document.createElement('div');
  hostEl.setAttribute(MARKER, '');
  const shadow = hostEl.attachShadow({ mode: 'closed' });
  document.documentElement.append(hostEl);

  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  shadow.append(style);

  const root = document.createElement('div');
  root.className = 'ov';
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Выберите таблицу для экспорта');
  shadow.append(root);

  // aria-live status banner (design §2.2): announces exactly what is highlighted.
  const status = document.createElement('div');
  status.className = 'ov__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent =
    'Выберите таблицу: Tab — следующая · 1–9 — по номеру · Enter — выбрать · Esc — отмена';
  root.append(status);

  const list = document.createElement('div');
  list.className = 'ov__list';
  root.append(list);

  let active = 0;
  const items: HTMLButtonElement[] = candidates.map((table, i) =>
    buildCandidate(table, i),
  );
  items.forEach((el) => list.append(el));

  function buildCandidate(table: TableModel, index: number): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cand';
    // Roving tabindex: only the active item is tabbable (design §10.1).
    btn.tabIndex = index === 0 ? 0 : -1;

    const num = document.createElement('span');
    num.className = 'cand__num';
    num.textContent = String(index + 1);
    btn.append(num);

    const label = document.createElement('span');
    label.className = 'cand__label';
    label.textContent = `Таблица · ${table.rows} × ${table.cols}${
      table.caption ? ` · «${table.caption}»` : ''
    }`;
    btn.append(label);

    // Warnings as TEXT, never colour alone (design §10.1 / WCAG 1.4.1).
    const warnings: string[] = [];
    if (table.hasMergedCells) warnings.push('⚠ объединённые ячейки');
    if (table.looksLikeLayout) warnings.push('⚠ похоже на вёрстку');
    if (table.virtualized) warnings.push('⚠ подгружается при прокрутке');
    if (warnings.length) {
      const warn = document.createElement('span');
      warn.className = 'cand__warn';
      warn.textContent = warnings.join(' · ');
      btn.append(warn);
    }

    btn.addEventListener('click', () => confirmPick(index));
    return btn;
  }

  function setActive(next: number): void {
    active = (next + items.length) % items.length;
    items.forEach((el, i) => {
      const on = i === active;
      el.tabIndex = on ? 0 : -1;
      el.classList.toggle('cand--active', on);
      if (on) {
        el.focus();
        el.scrollIntoView({ block: 'nearest' });
      }
    });
    const t = candidates[active]!;
    status.textContent = `Таблица ${active + 1} из ${items.length}. ${t.rows} строк, ${t.cols} колонок.`;
  }

  function confirmPick(index: number): void {
    void index;
    // TODO_LOGIC: extract the chosen table (utils/table-extract) and mount the
    // preview dialog ON THIS PAGE inside a closed shadow root (design §2.3). The
    // fully built preview UI lives in the React `preview` surface for the scaffold.
    status.textContent = 'Демо: здесь откроется превью экспорта (логика не подключена).';
  }

  function teardown(): void {
    document.removeEventListener('keydown', onKey, true);
    hostEl.remove();
    previouslyFocused?.focus?.();
  }

  // Capture-phase + stopPropagation: SPA pages hang their own Esc/Tab handlers and
  // would otherwise steal ours (design §10.1).
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      teardown();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      setActive(active + (e.shiftKey ? -1 : 1));
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      confirmPick(active);
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const n = Number(e.key) - 1;
      if (n < items.length) {
        e.preventDefault();
        e.stopPropagation();
        setActive(n);
      }
    }
  }

  const previouslyFocused = document.activeElement as HTMLElement | null;
  document.addEventListener('keydown', onKey, true);
  // Move focus into the overlay so the keyboard picker works immediately (§10.1).
  root.focus();
  if (items.length) setActive(0);
});

// Overlay styles. Double contrast ring (readable on ANY page background, since the
// page's colour is unknown — design §2.2/§10.2); forced-colors + reduced-motion
// honoured. Kept inline (no external CSS in an injected script).
const OVERLAY_CSS = `
:host { all: initial; }
.ov {
  position: fixed; inset: 0; z-index: 2147483647;
  font-family: system-ui, sans-serif; color: #fff;
  background: rgba(10, 12, 16, 0.55);
  display: flex; flex-direction: column; gap: 12px;
  padding: 16px; overflow: auto;
}
.ov__status {
  background: #111418; border: 1px solid #3c4043; border-radius: 8px;
  padding: 8px 12px; font-size: 13px;
}
.ov__list { display: flex; flex-direction: column; gap: 8px; max-width: 560px; }
.cand {
  appearance: none; text-align: left; cursor: pointer;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  background: #1b1f24; color: #e8eaed;
  border: 2px dashed #5f6368; border-radius: 8px;
  padding: 10px 12px; font: inherit; font-size: 13px;
}
.cand--active {
  border-style: solid; border-color: #8ab4f8;
  background: rgba(138, 180, 248, 0.18);
  outline: 2px solid #0b0d10; outline-offset: 2px; /* double ring */
  box-shadow: 0 0 0 4px #8ab4f8;
}
.cand:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.cand__num {
  flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%;
  background: #8ab4f8; color: #111418; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px;
}
.cand__label { font-weight: 600; }
.cand__warn { flex-basis: 100%; color: #fdd663; font-size: 12px; }
@media (prefers-reduced-motion: reduce) { .cand { transition: none; } }
@media (forced-colors: active) {
  .cand--active { border-color: Highlight; box-shadow: none; }
  .cand { color: CanvasText; }
}
`;
