import { todoLogic } from '@blur/ui';

// 🔴 THE SECURITY BOUNDARY (design §7.1, §7.2).
//
// This is the ONLY place in the entire codebase where an HTML STRING is allowed
// to become DOM. Everything that renders the preview goes through
// `sanitizeToFragment`. Keeping it to a single function is what makes the
// sanitizer physically impossible to bypass: there is no other point where a
// string turns into nodes.
//
// 🔴 HARD RULES (enforced by review + a planned ESLint ban):
//   - NO innerHTML / outerHTML / insertAdjacentHTML / dangerouslySetInnerHTML
//     anywhere — including "trusted" places.
//   - The function returns a DocumentFragment (RETURN_DOM_FRAGMENT), never a
//     string, and callers attach it with `el.replaceChildren(fragment)`.
//   - The sanitizer is held behind THIS one function so that if the native
//     Element.setHTML() / Sanitizer API reaches Baseline (design §7.2, PLAN-2
//     §11) only this file changes.

/** Explicit ALLOW-LIST — allow known-good, not "block known-bad" (design §7.2). */
export const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del',
  's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table',
  'thead', 'tbody', 'tr', 'th', 'td', 'kbd', 'sup', 'sub', 'details', 'summary',
  'span', 'div', 'input',
];

export const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'align', 'colspan', 'rowspan', 'class', 'type',
  'checked', 'disabled', 'open', 'lang', 'dir',
];

/** 🔴 Only http(s)/mailto. `javascript:`/`data:`/`blob:`/`vbscript:` are cut. */
export const ALLOWED_URI_REGEXP = /^(?:https?|mailto):/i;

/** What the sanitizer removed, for the "we stripped something" banner (§7.3). */
export interface SanitizeResult {
  fragment: DocumentFragment;
  /** Human descriptions of removed nodes/attrs, e.g. "<script> (1)". */
  removed: string[];
}

/**
 * Turn an (assumed HOSTILE) HTML string into a sanitized DocumentFragment.
 *
 * TODO_LOGIC (compose): wire the real DOMPurify pipeline:
 *   DOMPurify.sanitize(html, {
 *     RETURN_DOM_FRAGMENT: true,
 *     ALLOWED_TAGS, ALLOWED_ATTR,
 *     ALLOWED_URI_REGEXP,
 *     FORBID_CONTENTS: ['script', 'style'],
 *   })
 *   + afterSanitizeAttributes hook: force <input> to type=checkbox+disabled,
 *     set <a target=_blank rel="noopener noreferrer">, <img loading=lazy>.
 *   + uponSanitizeElement/Attribute hooks accumulate `removed[]`.
 * Until then this throws so no un-sanitized path can masquerade as working.
 */
export function sanitizeToFragment(_html: string): SanitizeResult {
  throw todoLogic('sanitize: DOMPurify(RETURN_DOM_FRAGMENT) allow-list pipeline');
}

/**
 * Build a SAFE, STATIC preview fragment WITHOUT going through a string. This is
 * the scaffold stand-in the preview renders today — it constructs nodes with
 * document.createElement + textContent only (never innerHTML), so it is honest
 * about the boundary while the real markdown→sanitize pipeline is stubbed.
 * `stripped` lets a caller simulate the §7.3 "sanitizer removed something"
 * banner state for design review.
 */
export function mockPreviewFragment(): SanitizeResult {
  const frag = document.createDocumentFragment();

  const h = document.createElement('h2');
  h.textContent = 'Что произошло';
  frag.append(h);

  const p = document.createElement('p');
  p.textContent = 'Аватарки не грузятся на /profile.';
  frag.append(p);

  const ul = document.createElement('ul');
  ul.className = 'cw-task-list';
  for (const [done, text] of [
    [true, 'Воспроизвёл в Firefox 141'],
    [false, 'Воспроизвёл в Chrome'],
  ] as const) {
    const li = document.createElement('li');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.disabled = true; // forced disabled — never interactive in a privileged page
    box.checked = done;
    li.append(box, document.createTextNode(' ' + text));
    ul.append(li);
  }
  frag.append(ul);

  const det = document.createElement('details');
  const sum = document.createElement('summary');
  sum.textContent = 'Логи консоли';
  const pre = document.createElement('pre');
  pre.textContent = 'GET /avatars/12.png 404';
  det.append(sum, pre);
  frag.append(det);

  return { fragment: frag, removed: [] };
}
