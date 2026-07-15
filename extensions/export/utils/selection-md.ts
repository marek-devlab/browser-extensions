// Selection → Markdown / plain text. Design §4.1 + §8.1.
//
// 🔴 ZERO innerHTML. We walk the DocumentFragment that `Range.cloneContents()`
// returns and emit strings. We never build an HTML string and never parse one back.
// This is also exactly why we do NOT use `turndown` (MIT, excellent): its RootNode
// does `div.innerHTML = input`, and the AMO linter flags BYTES, not code paths
// (design §8.1). Our converter is ~200 lines and produces zero warnings.
//
// ⚠️ `cloneContents()` hands back TRUNCATED nodes: half an <li>, a <td> with no
// <tr>, a <strong> that starts mid-word. The converter must therefore treat the
// fragment as a bag of nodes, never as a well-formed tree. Rules:
//   - an unterminated list  → plain paragraphs;
//   - a truncated table     → only WHOLE rows survive (design §6.7).

const MAX_DEPTH = 40;

interface Ctx {
  base: string;
  keepImages: boolean;
  absoluteLinks: boolean;
}

/** Escape the characters that would otherwise become Markdown syntax. Page text is
 *  untrusted: a cell reading `# not a heading` must not become one. */
function escapeMd(s: string): string {
  return s.replace(/([\\`*_[\]#>|])/g, '\\$1');
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ');
}

const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'BUTTON',
  'IFRAME',
  'CANVAS',
  'AUDIO',
  'VIDEO', // 🔴 listed only so it is SKIPPED. No media handling, ever (design §12).
]);

function abs(href: string, ctx: Ctx): string {
  if (!ctx.absoluteLinks) return href;
  try {
    return new URL(href, ctx.base).href;
  } catch {
    return href;
  }
}

/** Inline run of a node's children (bold/italic/code/links/images). */
function inline(node: Node, ctx: Ctx, depth: number): string {
  if (depth > MAX_DEPTH) return '';
  if (node.nodeType === Node.TEXT_NODE) return escapeMd(collapse(node.nodeValue ?? ''));
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (SKIP.has(tag)) return '';

  const inner = (): string =>
    Array.from(el.childNodes)
      .map((c) => inline(c, ctx, depth + 1))
      .join('');

  switch (tag) {
    case 'BR':
      return '  \n';
    case 'STRONG':
    case 'B': {
      const t = inner().trim();
      return t ? `**${t}**` : '';
    }
    case 'EM':
    case 'I': {
      const t = inner().trim();
      return t ? `*${t}*` : '';
    }
    case 'DEL':
    case 'S': {
      const t = inner().trim();
      return t ? `~~${t}~~` : '';
    }
    case 'CODE': {
      // Raw text (no md-escaping) inside backticks — that is what code spans are for.
      const t = collapse(el.textContent ?? '').trim();
      return t ? '`' + t.replace(/`/g, '') + '`' : '';
    }
    case 'IMG': {
      if (!ctx.keepImages) return '';
      const img = el as HTMLImageElement;
      const src = img.getAttribute('src');
      if (!src) return '';
      const resolved = abs(src, ctx);
      // 🔴 Same guard as the A branch: never emit javascript:/other-scheme URLs into
      // a file the user will open. After abs() a relative src is already absolute
      // http(s); anything that is not http(s) or a data:image is dropped to its alt.
      if (!/^(https?:|data:image\/)/i.test(resolved)) return escapeMd(img.alt ?? '');
      return `![${escapeMd(img.alt ?? '')}](${resolved})`;
    }
    case 'A': {
      const href = (el as HTMLAnchorElement).getAttribute('href');
      const label = inner().trim();
      if (!href) return label;
      // 🔴 Do not emit javascript:/data: links into a file the user will open.
      if (!/^(https?:|mailto:|#|\/|\.)/i.test(href)) return label;
      return label ? `[${label}](${abs(href, ctx)})` : '';
    }
    default:
      return inner();
  }
}

function textOnly(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  if (SKIP.has(el.tagName.toUpperCase())) return '';
  if (el.tagName === 'BR') return '\n';
  return Array.from(el.childNodes).map(textOnly).join('');
}

/** A <table> inside the selection → a GFM table. Truncated tables lose their
 *  partial rows rather than emitting a broken grid (design §6.7). */
function tableToMd(table: Element, ctx: Ctx): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length === 0) return '';
  // NB: `inline()` already escapes `|` via escapeMd — escaping it again here would
  // emit `\\|` and render a literal backslash in the cell.
  const grid = rows.map((tr) =>
    Array.from(tr.children)
      .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
      .map((c) => inline(c, ctx, 0).replace(/\n/g, ' ').trim()),
  );
  const width = Math.max(...grid.map((r) => r.length));
  if (width === 0) return '';
  // Drop rows that are not full rows — a partial row would shift every column.
  const whole = grid.filter((r) => r.length === width);
  if (whole.length === 0) return '';

  const head = whole[0]!;
  const body = whole.slice(1);
  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

/** Block-level walk. Emits an array of blocks joined by a blank line. */
function blocks(node: Node, ctx: Ctx, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH) return;

  if (node.nodeType === Node.TEXT_NODE) {
    const t = escapeMd(collapse(node.nodeValue ?? '')).trim();
    if (t) out.push(t);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (SKIP.has(tag)) return;

  const h = /^H([1-6])$/.exec(tag);
  if (h) {
    const t = inline(el, ctx, depth).trim();
    if (t) out.push(`${'#'.repeat(Number(h[1]))} ${t}`);
    return;
  }

  switch (tag) {
    case 'P':
    case 'DIV':
    case 'SECTION':
    case 'ARTICLE':
    case 'DD':
    case 'DT':
    case 'FIGCAPTION': {
      // A container may hold block children; if it does, recurse, else emit inline.
      const hasBlockChild = Array.from(el.children).some((c) =>
        /^(P|DIV|UL|OL|TABLE|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE|HR|FIGURE)$/.test(
          c.tagName,
        ),
      );
      if (hasBlockChild) {
        for (const c of el.childNodes) blocks(c, ctx, depth + 1, out);
      } else {
        const t = inline(el, ctx, depth).trim();
        if (t) out.push(t);
      }
      return;
    }
    case 'HR':
      out.push('---');
      return;
    case 'PRE': {
      const code = el.textContent ?? '';
      if (code.trim()) out.push('```\n' + code.replace(/```/g, '') + '\n```');
      return;
    }
    case 'BLOCKQUOTE': {
      const sub: string[] = [];
      for (const c of el.childNodes) blocks(c, ctx, depth + 1, sub);
      const q = sub.join('\n\n').split('\n').map((l) => `> ${l}`).join('\n');
      if (q.trim() !== '>') out.push(q);
      return;
    }
    case 'UL':
    case 'OL': {
      const ordered = tag === 'OL';
      const items = Array.from(el.children).filter((c) => c.tagName === 'LI');
      // ⚠️ An <ul> with no <li> survived the cut (selection started mid-list):
      // degrade to paragraphs rather than emitting an empty list (design §4.1).
      if (items.length === 0) {
        for (const c of el.childNodes) blocks(c, ctx, depth + 1, out);
        return;
      }
      const lines = items.map((li, i) => {
        const box = li.querySelector(':scope > input[type=checkbox]') as HTMLInputElement | null;
        const mark = box ? (box.checked ? '[x] ' : '[ ] ') : '';
        const t = inline(li, ctx, depth + 1).trim();
        return `${ordered ? `${i + 1}.` : '-'} ${mark}${t}`;
      });
      out.push(lines.join('\n'));
      return;
    }
    case 'TABLE': {
      const md = tableToMd(el, ctx);
      if (md) out.push(md);
      return;
    }
    case 'LI': {
      // A truncated <li> arrives without its parent list → plain paragraph.
      const t = inline(el, ctx, depth).trim();
      if (t) out.push(`- ${t}`);
      return;
    }
    case 'TR':
    case 'TD':
    case 'TH': {
      // Table pieces without their <table> — the selection cut through the table.
      const t = inline(el, ctx, depth).trim();
      if (t) out.push(t);
      return;
    }
    default: {
      const hasBlockChild = Array.from(el.children).some((c) =>
        /^(P|DIV|UL|OL|TABLE|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE|HR|LI|FIGURE)$/.test(
          c.tagName,
        ),
      );
      if (hasBlockChild) {
        for (const c of el.childNodes) blocks(c, ctx, depth + 1, out);
      } else {
        const t = inline(el, ctx, depth).trim();
        if (t) out.push(t);
      }
    }
  }
}

export interface SelectionOptions {
  keepImages?: boolean;
  absoluteLinks?: boolean;
}

/** DocumentFragment → Markdown. Exported separately from the DOM read so it can be
 *  exercised without a live selection. */
export function fragmentToMarkdown(
  fragment: DocumentFragment,
  baseUri: string,
  opts: SelectionOptions = {},
): string {
  const ctx: Ctx = {
    base: baseUri,
    keepImages: opts.keepImages ?? true,
    // Relative links in a saved file are useless — always resolve (design §3).
    absoluteLinks: opts.absoluteLinks ?? true,
  };
  const out: string[] = [];
  for (const child of fragment.childNodes) blocks(child, ctx, 0, out);
  return out
    .map((b) => b.trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** DocumentFragment → plain text (design §4.1, `.txt`). */
export function fragmentToText(fragment: DocumentFragment): string {
  const raw = Array.from(fragment.childNodes).map(textOnly).join('');
  return raw
    .split('\n')
    .map((l) => l.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Read the live selection. Returns `null` when there is nothing selected — the
 * caller must then say "выделение пропало", never save an empty file (design §5.1).
 */
export function readSelection(
  format: 'md' | 'txt',
  opts: SelectionOptions = {},
): string | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < sel.rangeCount; i++) {
    fragment.append(sel.getRangeAt(i).cloneContents());
  }
  const text =
    format === 'md'
      ? fragmentToMarkdown(fragment, document.baseURI, opts)
      : fragmentToText(fragment);
  return text.trim() ? text : null;
}
