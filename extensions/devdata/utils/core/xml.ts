// XML → value, on top of the NATIVE DOMParser (design §10.2: 0 KB, and
// `fast-xml-parser` is explicitly refused).
//
// SECURITY (design §7.3):
//   - Untrusted XML is parsed as `application/xml`, NEVER as `text/html`. HTML
//     parsing would build a live HTML tree from attacker text inside a
//     privileged extension page.
//   - A DTD that DECLARES entities is REFUSED outright. Browsers do not fetch
//     external entities (no XXE in the browser), but *internal* entity expansion
//     is a real "billion laughs" amplifier, and the cheapest correct answer is
//     not to play. The refusal is a proper DOCTYPE scan (`declaresEntities`
//     below), NOT a `<!DOCTYPE[^>]*` regex — a `>` is legal inside a quoted DTD
//     literal (`SYSTEM "a>b"`), so a regex that stops at the first `>` misses
//     `<!ENTITY` in the internal subset that follows. The scan walks the
//     DOCTYPE's true extent, honouring quoted literals.
//   - Nothing here ever touches innerHTML: the DOM is walked, and React renders
//     the resulting plain values.
//
// `DOMParser` is a *browser* API and does not exist in a Worker, so this module
// takes the parser by INJECTION (design §10.4) and the XML path runs on the main
// thread. XML documents are capped (below) so that stays a bounded cost.

import { buildTreeFromValue, type TreeResult } from './tree';

/** XML is parsed on the main thread; keep it to a size DOMParser handles fast. */
export const MAX_XML_BYTES = 20_000_000;

export class XmlRefused extends Error {}

/** The only DOM surface this module needs — injectable, so the core stays pure. */
export type XmlParse = (text: string) => Document;

/**
 * True when the document's DOCTYPE declares an XML entity (`<!ENTITY …>`).
 *
 * Robust against the SystemLiteral bypass: `>` is a legal character inside a
 * quoted DTD literal, so `<!DOCTYPE r SYSTEM "a>b" [<!ENTITY …]>` fools any
 * `<!DOCTYPE[^>]*` regex. This scans the DOCTYPE's real extent — skipping over
 * `'…'` / `"…"` literals and tracking the `[ … ]` internal-subset depth — and
 * only ends the DOCTYPE at a `>` that is outside both. It then looks for
 * `<!ENTITY` within that true span.
 */
export function declaresEntities(text: string): boolean {
  const m = /<!DOCTYPE/i.exec(text);
  if (!m) return false;
  const start = m.index;
  let i = start + m[0].length;
  let quote = '';
  let depth = 0;
  const n = text.length;
  for (; i < n; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '[') {
      depth += 1;
    } else if (c === ']') {
      if (depth > 0) depth -= 1;
    } else if (c === '>' && depth === 0) {
      i += 1;
      break;
    }
  }
  return /<!ENTITY/i.test(text.slice(start, i));
}

export function parseXmlToTree(text: string, parseXml: XmlParse): TreeResult & {
  warnings: string[];
} {
  if (text.length > MAX_XML_BYTES) {
    throw new XmlRefused(
      `XML-документ ${Math.round(text.length / 1_000_000)} МБ. XML разбирается нативным DOMParser в основном потоке, и предел здесь — ${MAX_XML_BYTES / 1_000_000} МБ. Разбейте документ или откройте его как текст.`,
    );
  }
  if (declaresEntities(text)) {
    throw new XmlRefused(
      'В документе объявлены XML-сущности (<!ENTITY …> внутри DOCTYPE). Мы отказываемся их разворачивать: это классический вектор «billion laughs» (лавинообразное раздувание памяти). Удалите DTD или уберите объявления сущностей.',
    );
  }

  const doc = parseXml(text);
  const error = doc.querySelector('parsererror');
  if (error) {
    throw new XmlRefused(
      `XML не разобран: ${(error.textContent ?? 'синтаксическая ошибка').trim().slice(0, 300)}`,
    );
  }
  const root = doc.documentElement;
  if (!root) throw new XmlRefused('XML не содержит корневого элемента.');

  const warnings: string[] = [];
  const { value, collapsed, hasAttrs } = elementToValue(root);
  if (collapsed) {
    warnings.push(
      'XML→JSON: повторяющиеся теги схлопнуты в массив. Один такой тег даёт одиночное значение, а не массив из одного элемента — это правило показано, а не спрятано.',
    );
  }
  if (hasAttrs) {
    warnings.push('XML→JSON: атрибуты записаны ключами с префиксом «@», текст узла — ключом «#text».');
  }
  warnings.push(
    'XML→JSON: типы не восстанавливаются. Всё содержимое XML — текст, поэтому «42» останется строкой "42".',
  );

  const tree = buildTreeFromValue({ [root.nodeName]: value });
  return { ...tree, warnings };
}

interface Converted {
  value: unknown;
  collapsed: boolean;
  hasAttrs: boolean;
}

/** DOM → plain value. Iterative post-order — no recursion (deep XML is real). */
function elementToValue(root: Element): Converted {
  let collapsed = false;
  let hasAttrs = false;

  // Post-order via an explicit two-phase stack.
  type Frame = { el: Element; visited: boolean };
  const stack: Frame[] = [{ el: root, visited: false }];
  const results = new Map<Element, unknown>();

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    const { el } = frame;
    if (!frame.visited) {
      stack.push({ el, visited: true });
      const kids = el.children;
      for (let i = kids.length - 1; i >= 0; i -= 1) {
        const child = kids[i];
        if (child) stack.push({ el: child, visited: false });
      }
      continue;
    }

    const out: Record<string, unknown> = {};
    for (const attr of Array.from(el.attributes)) {
      hasAttrs = true;
      out[`@${attr.name}`] = attr.value;
    }

    const grouped = new Map<string, unknown[]>();
    for (const child of Array.from(el.children)) {
      const list = grouped.get(child.nodeName) ?? [];
      list.push(results.get(child) ?? null);
      grouped.set(child.nodeName, list);
    }
    for (const [name, list] of grouped) {
      if (list.length > 1) collapsed = true;
      out[name] = list.length === 1 ? list[0] : list;
    }

    const text = directText(el);
    if (el.children.length === 0 && Object.keys(out).length === 0) {
      results.set(el, text === '' ? null : text);
      continue;
    }
    if (text !== '') out['#text'] = text;
    results.set(el, out);
  }

  return { value: results.get(root) ?? null, collapsed, hasAttrs };
}

/** Text belonging to this element itself (not to its element children). */
function directText(el: Element): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    // 3 = TEXT_NODE, 4 = CDATA_SECTION_NODE
    if (node.nodeType === 3 || node.nodeType === 4) text += node.nodeValue ?? '';
  }
  return text.trim();
}
