import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { sanitizeToFragment, serializeFragment, type SanitizeResult } from './sanitize';
import type { MsgKey } from './i18n';

type Translate = (key: MsgKey, vars?: Record<string, string | number>) => string;

// Markdown → preview render pipeline (design §7.1). The ONLY allowed pipeline:
//
//   draft(text)
//     → markdown-it({ html: true, linkify: false, typographer: false })
//     → HTML string (TREATED AS HOSTILE)
//     → sanitizeToFragment(html)        // the security boundary — utils/sanitize.ts
//     → DocumentFragment
//     → previewEl.replaceChildren(fragment)   // NODES, not a string
//
// ⚠️ `html: true` is mandatory (we need <details>); `linkify: false` is NOT
// cosmetic — auto-linking would turn arbitrary user text into href attributes,
// widening the attack surface (design §7.1). Links come only from an explicit
// [t](u). `typographer: false` because we must not silently rewrite the user's
// characters.

const md: MarkdownIt = new MarkdownIt('default', {
  html: true,
  linkify: false,
  typographer: false,
  breaks: false,
});

/**
 * GFM task lists (`- [ ]` / `- [x]`) — markdown-it has no built-in rule and we
 * are not adding a dependency for ~30 lines. This rewrites the first inline
 * token of a list item into a checkbox + the remaining text. The checkbox is
 * emitted as an `html_inline` token, which then goes through the sanitizer like
 * everything else (where it is forced `disabled`, design §7.2) — the parser is
 * never trusted to produce safe output.
 */
const TASK_RE = /^\[([ xX])\]\s+/;

md.core.ruler.after('inline', 'cw_task_lists', (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== 'inline') continue;
    const m = TASK_RE.exec(tok.content);
    if (!m) continue;

    const paragraphOpen = tokens[i - 1];
    const itemOpen = tokens[i - 2];
    if (!paragraphOpen || paragraphOpen.type !== 'paragraph_open') continue;
    if (!itemOpen || itemOpen.type !== 'list_item_open') continue;

    const checked = m[1] !== ' ';
    tok.content = tok.content.slice(m[0].length);
    const first = tok.children?.[0];
    if (first && first.type === 'text') {
      first.content = first.content.replace(TASK_RE, '');
    }
    const box = new state.Token('html_inline', '', 0);
    box.content = `<input type="checkbox" disabled${checked ? ' checked' : ''}> `;
    tok.children?.unshift(box);

    itemOpen.attrJoin('class', 'cw-task-item');
    for (let j = i - 3; j >= 0; j--) {
      const t = tokens[j];
      if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
        // attrJoin would append the class once per task item in the list.
        if (!(t.attrGet('class') ?? '').includes('cw-task-list')) {
          t.attrJoin('class', 'cw-task-list');
        }
        break;
      }
      if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') break;
    }
  }
  return true;
});

/** Render a draft body to a sanitized preview fragment — the only preview path. */
export function renderPreview(body: string, t?: Translate): SanitizeResult {
  return sanitizeToFragment(md.render(body), t);
}

/**
 * Render to a sanitized HTML STRING for the `text/html` clipboard flavour
 * (design §6.2). Goes through the exact same sanitizer, then serializes the DOM
 * back out — the string never re-enters the DOM.
 */
export function renderHtmlString(
  body: string,
  t?: Translate,
): { html: string; removed: string[] } {
  const { fragment, removed } = sanitizeToFragment(md.render(body), t);
  return { html: serializeFragment(fragment), removed };
}

/** The markdown-it token stream — the shared input of every platform converter. */
export function parseTokens(body: string): Token[] {
  return md.parse(body, {});
}

export type { Token };
