import type { MsgKey } from './i18n';

// Toolbar / keyboard markdown insertion (design §2.3, §9.1). ✅ REAL.
//
// This is pure string manipulation over the draft body + a selection range, so
// it is implemented for real in the scaffold (the task explicitly allows it).
// Each function takes the current body and [start,end] selection and returns the
// next body plus the next selection, so the caller (EditorPane) can restore the
// caret. No DOM, no browser APIs — trivially unit-testable.
//
// The starter placeholders inserted when there is NO selection ("bold", the
// <details> summary/body) follow the UI language, so `createActions(t)` binds
// the action map to the active-locale translator.

export interface EditState {
  body: string;
  start: number;
  end: number;
}

type T = (key: MsgKey, vars?: Record<string, string | number>) => string;

export type ActionId =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'codeBlock'
  | 'quote'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'link'
  | 'details'
  | 'table';

function wrap(s: EditState, before: string, after = before, placeholder = ''): EditState {
  const sel = s.body.slice(s.start, s.end) || placeholder;
  const body = s.body.slice(0, s.start) + before + sel + after + s.body.slice(s.end);
  return { body, start: s.start + before.length, end: s.start + before.length + sel.length };
}

/** Prefix every selected line (used for lists, quotes, tasks). */
function prefixLines(s: EditState, make: (i: number) => string): EditState {
  const lineStart = s.body.lastIndexOf('\n', s.start - 1) + 1;
  const region = s.body.slice(lineStart, s.end);
  const lines = region.split('\n');
  const next = lines.map((l, i) => make(i) + l).join('\n');
  const body = s.body.slice(0, lineStart) + next + s.body.slice(s.end);
  return { body, start: lineStart, end: lineStart + next.length };
}

/** Insert a fixed rows×cols markdown table (design §2.3, §9.1). */
export function insertTable(s: EditState, rows = 2, cols = 3): EditState {
  const cell = (fill: string) => '| ' + Array(cols).fill(fill).join(' | ') + ' |';
  const block = [cell('   '), cell('---'), ...Array(rows).fill(cell('   '))].join('\n') + '\n';
  const body = s.body.slice(0, s.start) + block + s.body.slice(s.end);
  return { body, start: s.start, end: s.start + block.length };
}

/** Insert an emoji symbol or shortcode at the caret (design §2.4). */
export function insertText(s: EditState, value: string): EditState {
  const body = s.body.slice(0, s.start) + value + s.body.slice(s.end);
  const pos = s.start + value.length;
  return { body, start: pos, end: pos };
}

// Every entry here is a uniform (EditState) => EditState transform, so indexing
// the map by a union key stays callable with a single argument. Actions that
// need extra parameters (table dims, emoji value) are the standalone functions
// above. `t` supplies the localized starter placeholders.
export function createActions(t: T): Record<ActionId, (s: EditState) => EditState> {
  return {
    bold: (s) => wrap(s, '**', '**', t('ph_bold')),
    italic: (s) => wrap(s, '*', '*', t('ph_italic')),
    strike: (s) => wrap(s, '~~', '~~', t('ph_strike')),
    code: (s) => wrap(s, '`', '`', t('ph_code')),
    codeBlock: (s) => wrap(s, '```\n', '\n```', t('ph_code')),
    quote: (s) => prefixLines(s, () => '> '),
    bullet: (s) => prefixLines(s, () => '- '),
    ordered: (s) => prefixLines(s, (i) => `${i + 1}. `),
    task: (s) => prefixLines(s, () => '- [ ] '),
    link: (s) => {
      const sel = s.body.slice(s.start, s.end) || t('ph_link');
      const insert = `[${sel}](url)`;
      const body = s.body.slice(0, s.start) + insert + s.body.slice(s.end);
      return { body, start: s.start + 1, end: s.start + 1 + sel.length };
    },
    // ⚠️ Blank lines around the body are MANDATORY or GitHub won't parse Markdown
    // inside <details> (design §2.3).
    details: (s) => {
      const summary = t('ph_summary');
      const insert = `<details>\n<summary>${summary}</summary>\n\n${t('ph_body')}\n\n</details>\n`;
      const body = s.body.slice(0, s.start) + insert + s.body.slice(s.end);
      const cursor = s.start + '<details>\n<summary>'.length;
      return { body, start: cursor, end: cursor + summary.length };
    },
    table: (s) => insertTable(s),
  };
}
