// The on-page picker (design §2.2 / §10.1) — used for TABLES and, on a device with
// no right-click, for IMAGES too.
//
// It is NOT a uBO-style "highlight whatever is under the mouse" picker: our
// candidate set is FINITE and KNOWN, so every candidate is ringed and NUMBERED up
// front — the user sees how many there are before hovering anything.
//
// Unlike `adblock/utils/element-picker.ts` (mouse-only, `e.target`), this one is
// keyboard-first — Tab / 1–9 / ↑↓ / Enter / Esc — AND exposes a real button list,
// so it works with a touch screen and no context menu at all. That is the whole
// mobile story: Firefox for Android has no `contextMenus` and no right-click, so
// every capability must be reachable from the popup → this picker.

import type { Locale } from '@blur/ui';
import {
  button,
  createRing,
  destroyOverlay,
  el,
  getHost,
  trackRings,
  trapKeys,
  type OverlayTheme,
  type Ring,
} from './overlay';
import { tAt } from './i18n';

export interface Candidate {
  id: string;
  element: Element;
  label: string;
  /** Shown as TEXT under the label — never colour alone (design §10.1). */
  warnings: string[];
}

export interface PickOptions {
  multi: boolean;
  theme: OverlayTheme;
  title: string;
  locale: Locale;
}

export function pickElements(
  candidates: Candidate[],
  opts: PickOptions,
): Promise<string[] | null> {
  return new Promise((resolve) => {
    const h = getHost(opts.theme);
    h.ui.replaceChildren();
    h.layer.replaceChildren();

    const rings: Ring[] = [];
    const selected = new Set<string>();
    let active = 0;

    const panel = el('div', 'bx-panel bx-panel--top');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', opts.title);

    const status = el('p', 'bx-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite'); // announces exactly what is ringed
    panel.append(status);

    const list = el('ul', 'bx-list');
    panel.append(list);

    const items: HTMLButtonElement[] = [];

    candidates.forEach((c, i) => {
      rings.push(createRing(c.element, c.label, i));

      const li = el('li');
      const btn = el('button', 'bx-cand');
      btn.type = 'button';
      btn.tabIndex = i === 0 ? 0 : -1; // roving tabindex (design §10.1)
      btn.append(el('span', 'bx-cand__num', String(i + 1)));
      btn.append(el('span', 'bx-cand__label', c.label));
      if (c.warnings.length) btn.append(el('span', 'bx-cand__warn', c.warnings.join(' · ')));

      btn.addEventListener('click', () => {
        if (opts.multi) toggle(i);
        else finish([c.id]);
      });
      btn.addEventListener('focus', () => setActive(i, false));

      li.append(btn);
      list.append(li);
      items.push(btn);
    });

    const foot = el('div', 'bx-foot');
    if (opts.multi) {
      foot.append(
        button(tAt(opts.locale, 'selectAll'), () => {
          for (const c of candidates) selected.add(c.id);
          render();
        }, 'bx-btn--ghost'),
      );
      foot.append(
        button(tAt(opts.locale, 'exportSelected'), () => {
          if (selected.size) finish([...selected]);
        }, 'bx-btn--primary'),
      );
    }
    foot.append(button(tAt(opts.locale, 'cancel'), () => finish(null), 'bx-btn--ghost'));
    panel.append(foot);

    h.ui.append(panel);
    const untrack = trackRings(rings);

    const release = trapKeys(panel, {
      onEscape: () => finish(null),
      onKey: (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          setActive(active + (e.key === 'ArrowDown' ? 1 : -1), true);
          return true;
        }
        if (e.key === 'Enter') {
          if (opts.multi && selected.size) finish([...selected]);
          else if (!opts.multi && candidates[active]) finish([candidates[active]!.id]);
          return true;
        }
        if (e.key === ' ' && opts.multi) {
          toggle(active);
          return true;
        }
        if (opts.multi && (e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф')) {
          for (const c of candidates) selected.add(c.id);
          render();
          return true;
        }
        if (/^[1-9]$/.test(e.key)) {
          const n = Number(e.key) - 1;
          if (n < items.length) {
            if (opts.multi) toggle(n);
            else finish([candidates[n]!.id]);
            return true;
          }
        }
        return false;
      },
    });

    function toggle(i: number): void {
      const id = candidates[i]!.id;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      setActive(i, true);
    }

    function setActive(next: number, focus: boolean): void {
      if (items.length === 0) return;
      active = (next + items.length) % items.length;
      items.forEach((b, i) => {
        b.tabIndex = i === active ? 0 : -1;
        b.classList.toggle('bx-cand--active', i === active);
      });
      rings.forEach((r, i) => r.box.classList.toggle('bx-ring--active', i === active));
      if (focus) {
        items[active]?.focus();
        // ⚠️ The picker does NOT block page scrolling: a table can be far taller
        // than the viewport, and the rings reposition in one rAF (design §2.2).
        candidates[active]?.element.scrollIntoView({ block: 'nearest' });
      }
      render();
    }

    function render(): void {
      items.forEach((b, i) => {
        const id = candidates[i]!.id;
        b.setAttribute('aria-pressed', opts.multi ? String(selected.has(id)) : 'false');
        const num = b.querySelector('.bx-cand__num');
        if (num) num.textContent = opts.multi && selected.has(id) ? '✓' : String(i + 1);
      });
      const c = candidates[active];
      const hint = opts.multi
        ? tAt(opts.locale, 'pickHintMulti')
        : tAt(opts.locale, 'pickHintSingle');
      const counter = opts.multi
        ? tAt(opts.locale, 'pickCounter', { n: selected.size, total: candidates.length })
        : '';
      const desc = c
        ? tAt(opts.locale, 'pickDesc', {
            i: active + 1,
            total: candidates.length,
            label: c.label,
            warnings: c.warnings.join('. '),
          })
        : '';
      status.textContent = `${opts.title}. ${counter}${desc} ${hint}`;
    }

    function finish(ids: string[] | null): void {
      release();
      untrack();
      h.layer.replaceChildren();
      h.ui.replaceChildren();
      if (!ids) destroyOverlay();
      resolve(ids);
    }

    items[0]?.setAttribute('data-autofocus', '');
    setActive(0, true);
    items[0]?.focus();
  });
}
