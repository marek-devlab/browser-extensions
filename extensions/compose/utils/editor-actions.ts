// Toolbar / keyboard markdown insertion (design §2.3, §9.1). ✅ REAL.
//
// This is pure string manipulation over the draft body + a selection range, so
// it is implemented for real in the scaffold (the task explicitly allows it).
// Each function takes the current body and [start,end] selection and returns the
// next body plus the next selection, so the caller (EditorPane) can restore the
// caret. No DOM, no browser APIs — trivially unit-testable.

export interface EditState {
  body: string;
  start: number;
  end: number;
}

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
// above.
export const actions = {
  bold: (s: EditState) => wrap(s, '**', '**', 'жирный'),
  italic: (s: EditState) => wrap(s, '*', '*', 'курсив'),
  strike: (s: EditState) => wrap(s, '~~', '~~', 'зачёркнутый'),
  code: (s: EditState) => wrap(s, '`', '`', 'код'),
  codeBlock: (s: EditState) => wrap(s, '```\n', '\n```', 'код'),
  quote: (s: EditState) => prefixLines(s, () => '> '),
  bullet: (s: EditState) => prefixLines(s, () => '- '),
  ordered: (s: EditState) => prefixLines(s, (i) => `${i + 1}. `),
  task: (s: EditState) => prefixLines(s, () => '- [ ] '),
  link: (s: EditState) => {
    const sel = s.body.slice(s.start, s.end) || 'текст';
    const insert = `[${sel}](url)`;
    const body = s.body.slice(0, s.start) + insert + s.body.slice(s.end);
    return { body, start: s.start + 1, end: s.start + 1 + sel.length };
  },
  // ⚠️ Blank lines around the body are MANDATORY or GitHub won't parse Markdown
  // inside <details> (design §2.3).
  details: (s: EditState) => {
    const insert = '<details>\n<summary>КАРЕТКА</summary>\n\nтело\n\n</details>\n';
    const body = s.body.slice(0, s.start) + insert + s.body.slice(s.end);
    const cursor = s.start + '<details>\n<summary>'.length;
    return { body, start: cursor, end: cursor + 'КАРЕТКА'.length };
  },
  table: (s: EditState) => insertTable(s),
} satisfies Record<string, (s: EditState) => EditState>;

export type ActionId = keyof typeof actions;
