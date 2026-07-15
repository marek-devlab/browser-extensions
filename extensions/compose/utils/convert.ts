import { parseTokens, renderHtmlString, type Token } from './markdown';
import type { Target } from './types';

// Platform CONVERSION on copy (design §6.2, §6.3).
//
// 🔴 INVARIANT (design §4.5): the stored Markdown is NEVER rewritten by a
// converter. `convert()` runs ONLY at the moment of copy and produces a fresh
// string; switching target back and forth is lossless because nothing is written
// back.
//
// 🔴 The converter NEVER silently drops content (design §6.3): anything the
// target cannot express DEGRADES with the text preserved (table → aligned code
// block, <details> → expanded text) and every degradation is reported BEFORE the
// copy happens (the §6.4 dialog).
//
// Everything is driven off the ONE markdown-it token stream (utils/markdown.ts),
// so there are no five raw-text regex transformers to keep in sync.

export interface ConversionResult {
  /** The text placed on the clipboard for this target. */
  text: string;
  /** For `html`, also a text/html payload (design §6.2). */
  html?: string;
  /** Human notes about lossy degradations, shown before/at copy (design §6.4). */
  degradations: string[];
}

export interface ConvertOptions {
  /**
   * Resolve `:shortcode:` → Unicode emoji. Jira and Telegram do not understand
   * shortcodes (design §6.1), so the copy path passes a resolver backed by the
   * LAZILY loaded emoji index — the emoji data must never be pulled into the
   * main bundle just to convert (design §10.2).
   */
  shortcodeToEmoji?: (shortcode: string) => string | null;
}

/* ── degradation bookkeeping ───────────────────────────────────────────────*/

class Degradations {
  private items = new Map<string, number>();
  add(what: string): void {
    this.items.set(what, (this.items.get(what) ?? 0) + 1);
  }
  list(): string[] {
    return [...this.items.entries()].map(([what, n]) => (n > 1 ? `${what} (×${n})` : what));
  }
}

/* ── token tree ────────────────────────────────────────────────────────────*/

interface Node {
  type: string;
  token: Token;
  children: Node[];
}

/** markdown-it emits a flat open/close stream; a tree is far easier to convert. */
function toTree(tokens: Token[]): Node[] {
  const root: Node[] = [];
  const stack: Node[][] = [root];
  for (const token of tokens) {
    const bucket = stack[stack.length - 1];
    if (token.nesting === 1) {
      const node: Node = { type: token.type.replace(/_open$/, ''), token, children: [] };
      bucket.push(node);
      stack.push(node.children);
    } else if (token.nesting === -1) {
      if (stack.length > 1) stack.pop();
    } else {
      bucket.push({ type: token.type, token, children: [] });
    }
  }
  return root;
}

/* ── escaping (design §6.1) ────────────────────────────────────────────────*/

/** ⚠️ Telegram MarkdownV2: the single most common cause of "Telegram rejects my
 *  markup" is a missed escape. EVERY one of these must be backslash-escaped
 *  outside code spans. */
const TELEGRAM_SPECIALS = /[_*[\]()~`>#+\-=|{}.!\\]/g;

function escapeFor(target: Target, s: string): string {
  switch (target) {
    case 'telegram':
      return s.replace(TELEGRAM_SPECIALS, (c) => '\\' + c);
    case 'slack':
      // Slack mrkdwn only reserves the three HTML-ish characters.
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    case 'jira':
      // Jira wiki markup: a leading backslash escapes a formatting character.
      return s.replace(/[{}[\]*_+^~|-]/g, (c) => '\\' + c);
    default:
      return s;
  }
}

/* ── inline rendering ──────────────────────────────────────────────────────*/

interface Ctx {
  target: Target;
  deg: Degradations;
  emoji?: (shortcode: string) => string | null;
}

const SHORTCODE_RE = /:([a-z0-9_+-]+):/gi;

/** Jira and Telegram do not know `:tada:` — swap it for the character (§6.1). */
function resolveShortcodes(ctx: Ctx, text: string): string {
  if (ctx.target !== 'jira' && ctx.target !== 'telegram') return text;
  if (!ctx.emoji) return text;
  return text.replace(SHORTCODE_RE, (whole, name: string) => {
    const char = ctx.emoji?.(name);
    if (char) {
      ctx.deg.add('Шорткоды эмодзи (:tada:) → символ — площадка их не понимает');
      return char;
    }
    return whole;
  });
}

function renderInline(nodes: Node[], ctx: Ctx): string {
  let out = '';
  for (const n of nodes) {
    const t = n.token;
    switch (n.type) {
      case 'text':
        out += escapeFor(ctx.target, resolveShortcodes(ctx, t.content));
        break;
      case 'strong':
        out += wrapStrong(ctx, renderInline(n.children, ctx));
        break;
      case 'em':
        out += wrapEm(ctx, renderInline(n.children, ctx));
        break;
      case 's':
        out += wrapStrike(ctx, renderInline(n.children, ctx));
        break;
      case 'code_inline':
        out += inlineCode(ctx, t.content);
        break;
      case 'link':
        out += link(ctx, t.attrGet('href') ?? '', renderInline(n.children, ctx));
        break;
      case 'image':
        out += image(ctx, t.attrGet('src') ?? '', t.content);
        break;
      case 'softbreak':
      case 'hardbreak':
        out += '\n';
        break;
      case 'html_inline': {
        // Inline HTML has no equivalent in any plain-text target. The TEXT is
        // never dropped (§6.3) — only the tag markers are. A tag-only token (the
        // task-list checkbox this parser injects, a <br>) contributes nothing:
        // the checkbox is already carried by the list marker.
        const inner = stripTags(t.content);
        if (inner.trim() !== '') out += escapeFor(ctx.target, inner);
        break;
      }
      default:
        if (n.children.length) out += renderInline(n.children, ctx);
        else if (t.content) out += escapeFor(ctx.target, t.content);
    }
  }
  return out;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function wrapStrong(ctx: Ctx, inner: string): string {
  switch (ctx.target) {
    case 'jira':
    case 'slack':
    case 'telegram':
      return `*${inner}*`;
    default:
      return inner;
  }
}

function wrapEm(ctx: Ctx, inner: string): string {
  switch (ctx.target) {
    case 'jira':
    case 'slack':
    case 'telegram':
      return `_${inner}_`;
    default:
      return inner;
  }
}

function wrapStrike(ctx: Ctx, inner: string): string {
  switch (ctx.target) {
    case 'jira':
      return `-${inner}-`;
    case 'slack':
    case 'telegram':
      return `~${inner}~`;
    default:
      return inner;
  }
}

function inlineCode(ctx: Ctx, code: string): string {
  switch (ctx.target) {
    case 'jira':
      return `{{${code}}}`;
    case 'slack':
      return `\`${code}\``;
    case 'telegram':
      // Inside a code span only ` and \ are escaped (MarkdownV2).
      return '`' + code.replace(/[`\\]/g, (c) => '\\' + c) + '`';
    default:
      return code;
  }
}

function link(ctx: Ctx, href: string, text: string): string {
  switch (ctx.target) {
    case 'jira':
      return `[${text}|${href}]`;
    case 'slack':
      return `<${href}|${text}>`;
    case 'telegram':
      // The URL inside (...) escapes only ) and \.
      return `[${text}](${href.replace(/[)\\]/g, (c) => '\\' + c)})`;
    default:
      return text ? `${text} (${href})` : href;
  }
}

function image(ctx: Ctx, src: string, alt: string): string {
  switch (ctx.target) {
    case 'jira':
      return `!${src}!`;
    case 'slack':
      return `<${src}|${alt || 'изображение'}>`;
    case 'telegram':
      return `[${escapeFor('telegram', alt || 'изображение')}](${src})`;
    default:
      return alt ? `${alt} (${src})` : src;
  }
}

/* ── block rendering ───────────────────────────────────────────────────────*/

function renderBlocks(nodes: Node[], ctx: Ctx): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    const chunk = renderBlock(n, ctx);
    if (chunk !== null) out.push(chunk);
  }
  return out;
}

function renderBlock(n: Node, ctx: Ctx): string | null {
  const t = n.token;
  switch (n.type) {
    case 'heading': {
      const level = Number(t.tag.slice(1)) || 1;
      const inline = inlineOf(n, ctx);
      switch (ctx.target) {
        case 'jira':
          return `h${level}. ${inline}`;
        case 'slack':
          ctx.deg.add('Заголовки → *жирный* (в Slack заголовков нет)');
          return `*${inline}*`;
        case 'telegram':
          ctx.deg.add('Заголовки → *жирный* (в Telegram заголовков нет)');
          return `*${inline}*`;
        default:
          ctx.deg.add('Заголовки → ВЕРХНИЙ РЕГИСТР');
          return inline.toUpperCase();
      }
    }

    case 'paragraph':
      return inlineOf(n, ctx);

    case 'blockquote': {
      const body = renderBlocks(n.children, ctx).join('\n\n');
      if (ctx.target === 'jira') return `{quote}\n${body}\n{quote}`;
      return body
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    }

    case 'fence':
    case 'code_block': {
      const lang = (t.info || '').trim().split(/\s+/)[0] ?? '';
      const code = t.content.replace(/\n$/, '');
      switch (ctx.target) {
        case 'jira':
          return lang ? `{code:${lang}}\n${code}\n{code}` : `{code}\n${code}\n{code}`;
        case 'slack':
          if (lang) ctx.deg.add('Блок кода → ``` без указания языка (Slack его не понимает)');
          return '```\n' + code + '\n```';
        case 'telegram':
          return '```' + lang + '\n' + code.replace(/[`\\]/g, (c) => '\\' + c) + '\n```';
        default:
          return code
            .split('\n')
            .map((l) => '    ' + l)
            .join('\n');
      }
    }

    case 'bullet_list':
    case 'ordered_list': {
      const ordered = n.type === 'ordered_list';
      const lines: string[] = [];
      let i = 1;
      for (const item of n.children) {
        if (item.type !== 'list_item') continue;
        const isTask = (item.token.attrGet('class') ?? '').includes('cw-task-item');
        const checked = isTaskChecked(item);
        const body = renderBlocks(item.children, ctx).join('\n\n');
        const marker = listMarker(ctx, { ordered, index: i, isTask, checked });
        const indented = body
          .split('\n')
          .map((l, k) => (k === 0 ? marker + l : ' '.repeat(marker.length) + l))
          .join('\n');
        lines.push(indented);
        i++;
      }
      return lines.join('\n');
    }

    case 'table':
      return renderTable(n, ctx);

    case 'hr':
      return ctx.target === 'jira' ? '----' : '───';

    case 'html_block':
      return renderHtmlBlock(t.content, ctx);

    case 'inline':
      return renderInline(toTree(t.children ?? []), ctx);

    default: {
      if (n.children.length) return renderBlocks(n.children, ctx).join('\n\n');
      return t.content ? escapeFor(ctx.target, t.content) : null;
    }
  }
}

function inlineOf(n: Node, ctx: Ctx): string {
  const inline = n.children.find((c) => c.type === 'inline');
  if (!inline) return renderInline(n.children, ctx);
  return renderInline(toTree(inline.token.children ?? []), ctx);
}

function isTaskChecked(item: Node): boolean {
  const inline = item.children.find((c) => c.type === 'paragraph')?.children.find((c) => c.type === 'inline');
  const first = inline?.token.children?.[0];
  return !!first && first.type === 'html_inline' && first.content.includes('checked');
}

function listMarker(
  ctx: Ctx,
  o: { ordered: boolean; index: number; isTask: boolean; checked: boolean },
): string {
  if (o.isTask) {
    switch (ctx.target) {
      case 'jira':
        ctx.deg.add('Чекбоксы → (x)/( ) (кликабельных чекбоксов в Jira нет)');
        return o.checked ? '* (x) ' : '* ( ) ';
      case 'slack':
      case 'telegram':
        ctx.deg.add('Чекбоксы → • ☐ / • ☑ (кликабельных чекбоксов нет)');
        return o.checked ? '• ☑ ' : '• ☐ ';
      default:
        return o.checked ? '[x] ' : '[ ] ';
    }
  }
  if (ctx.target === 'jira') return o.ordered ? '# ' : '* ';
  if (o.ordered) return `${o.index}. `;
  return ctx.target === 'plain' ? '- ' : '• ';
}

/* ── tables (design §6.1, §6.2) ────────────────────────────────────────────*/

function renderTable(n: Node, ctx: Ctx): string {
  const rows: { cells: string[]; head: boolean }[] = [];
  const walk = (nodes: Node[], head: boolean) => {
    for (const s of nodes) {
      if (s.type === 'thead') walk(s.children, true);
      else if (s.type === 'tbody') walk(s.children, false);
      else if (s.type === 'tr') {
        rows.push({
          head,
          cells: s.children
            .filter((c) => c.type === 'th' || c.type === 'td')
            .map((c) => inlineOf(c, ctx).replace(/\n/g, ' ')),
        });
      }
    }
  };
  walk(n.children, false);
  if (rows.length === 0) return '';

  if (ctx.target === 'jira') {
    return rows
      .map((r) => (r.head ? `||${r.cells.join('||')}||` : `|${r.cells.join('|')}|`))
      .join('\n');
  }

  // Slack / Telegram / Plain have NO tables. Degrade to an aligned monospace
  // block — the text survives (§6.3), only the grid does not.
  const width = rows[0].cells.map((_, i) =>
    Math.max(...rows.map((r) => [...(r.cells[i] ?? '')].length)),
  );
  const ascii = rows
    .map((r) => r.cells.map((c, i) => c.padEnd(width[i] ?? c.length)).join('  ').trimEnd())
    .join('\n');

  if (ctx.target === 'plain') {
    ctx.deg.add(`Таблица (строк: ${rows.length}) → выровненный текст`);
    return ascii;
  }
  ctx.deg.add(`Таблица (строк: ${rows.length}) → блок кода с выравниванием`);
  return '```\n' + ascii + '\n```';
}

/* ── <details> and other raw HTML (design §6.2) ────────────────────────────*/

const DETAILS_OPEN_RE = /<details[^>]*>/i;
const DETAILS_CLOSE_RE = /<\/details>/i;
const SUMMARY_RE = /<summary[^>]*>([\s\S]*?)<\/summary>/i;

/**
 * `<details>` reaches the converter as `html_block` tokens (markdown-it with
 * `html: true` leaves them raw and parses the markdown BETWEEN them normally).
 * Only the open/close markers are rewritten — the body is already handled as
 * ordinary blocks, so nothing is ever lost.
 */
function renderHtmlBlock(content: string, ctx: Ctx): string | null {
  const hasOpen = DETAILS_OPEN_RE.test(content);
  const hasClose = DETAILS_CLOSE_RE.test(content);

  if (hasOpen) {
    const summaryRaw = SUMMARY_RE.exec(content)?.[1] ?? '';
    const summary = escapeFor(ctx.target, stripTags(summaryRaw).trim() || 'Подробности');
    switch (ctx.target) {
      case 'jira':
        ctx.deg.add(`<details> «${stripTags(summaryRaw).trim()}» → {expand}`);
        return `{expand:${stripTags(summaryRaw).trim()}}`;
      case 'slack':
      case 'telegram':
        ctx.deg.add(
          `<details> «${stripTags(summaryRaw).trim()}» → раскрывающегося блока нет, тело развёрнуто под жирным заголовком`,
        );
        return `*${summary}*`;
      default:
        ctx.deg.add(`<details> «${stripTags(summaryRaw).trim()}» → развёрнуто`);
        return `${summary}:`;
    }
  }

  if (hasClose) {
    return ctx.target === 'jira' ? '{expand}' : null;
  }

  // Any other raw HTML: keep the TEXT, drop the tags (§6.3 — never silently
  // lose content).
  const text = stripTags(content).trim();
  return text ? escapeFor(ctx.target, text) : null;
}

/* ── public API ────────────────────────────────────────────────────────────*/

/**
 * Convert the draft body to the target platform's syntax. Pure: it reads the
 * body and returns a NEW string. The draft is never touched (design §4.5).
 */
export function convert(body: string, target: Target, opts: ConvertOptions = {}): ConversionResult {
  // GitHub: we ARE GFM. Identity — no parse, no risk, no degradation.
  if (target === 'github') {
    return { text: body, degradations: [] };
  }

  // GitLab: byte-identical body, but GLFM is not GFM — its own <details>, its
  // own extensions render some constructs differently than this preview. Ship
  // the body verbatim yet flag one non-blocking, informational degradation so
  // the CounterStrip is honest rather than promising "✓ совместимо" (design §6.2).
  if (target === 'gitlab') {
    return {
      text: body,
      degradations: ['GitLab (GLFM) отображает часть конструкций иначе, чем этот предпросмотр'],
    };
  }

  // HTML: sanitized DOM → serialized string. `text/plain` stays clean Markdown
  // so a plain <textarea> receives the source (design §6.2).
  if (target === 'html') {
    const { html, removed } = renderHtmlString(body);
    return {
      text: body,
      html,
      degradations: removed.length
        ? [`Санитайзер вырезал из HTML: ${removed.join(', ')}`]
        : [],
    };
  }

  const deg = new Degradations();
  const ctx: Ctx = { target, deg, emoji: opts.shortcodeToEmoji };
  const tree = toTree(parseTokens(body));
  const text = renderBlocks(tree, ctx)
    .filter((s) => s.trim() !== '')
    .join('\n\n');
  return { text, degradations: deg.list() };
}

/**
 * The degradations ONLY — for the CounterStrip status line and the §6.4 dialog,
 * which must be shown BEFORE the copy happens. Same code path as `convert`, so
 * the warning can never disagree with what actually lands on the clipboard.
 */
export function analyze(body: string, target: Target, opts: ConvertOptions = {}): string[] {
  return convert(body, target, opts).degradations;
}
