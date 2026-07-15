// Serialisation + conversion, with the MANDATORY lossy-conversion warnings
// (design §2.5, §4.6). Converting JSON → XML/CSV throws information away, and
// silently throwing it away is exactly "lying in the UI". Every lossy step
// reports itself here and the Data tab is required to show the panel.
//
// Pure module: no DOM, no browser APIs (XML is *emitted* as text, and XML is
// *parsed* on the main thread via DOMParser — see utils/core/xml.ts). This is
// what lets the Worker import it.

import { childrenOf, type FlatNode } from './tree';

export interface ConversionWarning {
  severity: 'warn' | 'poor';
  message: string;
}

export type IndentPref = '2' | '4' | 'tab' | 'min';

export function indentString(pref: IndentPref): string {
  switch (pref) {
    case '2':
      return '  ';
    case '4':
      return '    ';
    case 'tab':
      return '\t';
    case 'min':
      return '';
  }
}

/* --------------------------------------------------------------------------
 * JSON emit — straight from the flat tree, so the EXACT source spelling of
 * every scalar survives beautify/minify. `JSON.stringify(JSON.parse(text))`
 * would quietly round 12345678901234567890 down to ...000; this does not.
 * Iterative (explicit stack): deep documents must not blow the JS stack.
 * ------------------------------------------------------------------------ */

type EmitItem = { t: 'node'; i: number; depth: number } | { t: 'text'; s: string };

export function emitJson(
  nodes: FlatNode[],
  opts: { indent: string; sortKeys: boolean },
): string {
  if (nodes.length === 0) return '';
  const { indent, sortKeys } = opts;
  const nl = indent === '' ? '' : '\n';
  const sep = indent === '' ? ':' : ': ';
  const out: string[] = [];
  const stack: EmitItem[] = [{ t: 'node', i: 0, depth: 0 }];

  while (stack.length > 0) {
    const item = stack.pop() as EmitItem;
    if (item.t === 'text') {
      out.push(item.s);
      continue;
    }
    const node = nodes[item.i];
    if (!node) continue;

    if (node.kind !== 'object' && node.kind !== 'array') {
      out.push(node.raw ?? 'null');
      continue;
    }

    const isObject = node.kind === 'object';
    const open = isObject ? '{' : '[';
    const close = isObject ? '}' : ']';
    let kids = childrenOf(nodes, item.i);
    if (kids.length === 0) {
      out.push(open + close);
      continue;
    }
    if (isObject && sortKeys) {
      kids = [...kids].sort((a, b) =>
        (nodes[a]?.key ?? '').localeCompare(nodes[b]?.key ?? ''),
      );
    }

    out.push(open);
    // Push in reverse: the last thing pushed is emitted first.
    stack.push({ t: 'text', s: `${nl}${indent.repeat(item.depth)}${close}` });
    for (let k = kids.length - 1; k >= 0; k -= 1) {
      const ki = kids[k];
      if (ki === undefined) continue;
      if (k < kids.length - 1) stack.push({ t: 'text', s: ',' });
      stack.push({ t: 'node', i: ki, depth: item.depth + 1 });
      const key = nodes[ki]?.key;
      const prefix =
        isObject && key !== null && key !== undefined
          ? `${JSON.stringify(key)}${sep}`
          : '';
      stack.push({
        t: 'text',
        s: `${nl}${indent.repeat(item.depth + 1)}${prefix}`,
      });
    }
  }

  return out.join('');
}

/* --------------------------------------------------------------------------
 * XML emit (native side: no library — design §10.2 bans fast-xml-parser).
 * ------------------------------------------------------------------------ */

const XML_NAME_START = /[A-Za-z_:]/;
const XML_NAME_CHAR = /[A-Za-z0-9_:.-]/;

/**
 * Coerce an object key into a legal XML element name, reporting the change.
 *
 * A key that merely STARTS wrong (`2fa`) is prefixed, not mutilated: `_2fa`,
 * never `_fa`. Silently eating a character would be data loss inside the very
 * function whose job is to announce data loss.
 */
export function xmlName(key: string): { name: string; changed: boolean } {
  let out = '';
  for (let i = 0; i < key.length; i += 1) {
    const c = key[i] as string;
    out += XML_NAME_CHAR.test(c) ? c : '_';
  }
  const first = out[0];
  if (out === '' || first === undefined || !XML_NAME_START.test(first)) {
    out = `_${out}`;
  }
  return { name: out, changed: out !== key };
}

export function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** JSON → XML. Iterative. Returns the document plus its honest loss list. */
export function emitXml(
  nodes: FlatNode[],
  opts: { indent: string },
): { text: string; warnings: ConversionWarning[] } {
  const warnings: ConversionWarning[] = [];
  const renamed = new Set<string>();
  let nullCount = 0;
  const { indent } = opts;
  const nl = indent === '' ? '' : '\n';
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', nl || ''];

  if (nodes.length === 0) {
    return { text: '<?xml version="1.0" encoding="UTF-8"?>\n<root/>', warnings };
  }

  type Item =
    | { t: 'node'; i: number; depth: number; tag: string }
    | { t: 'text'; s: string };
  const stack: Item[] = [{ t: 'node', i: 0, depth: 0, tag: 'root' }];

  while (stack.length > 0) {
    const item = stack.pop() as Item;
    if (item.t === 'text') {
      out.push(item.s);
      continue;
    }
    const node = nodes[item.i];
    if (!node) continue;
    const pad = indent.repeat(item.depth);

    if (node.kind === 'object' || node.kind === 'array') {
      const kids = childrenOf(nodes, item.i);
      if (kids.length === 0) {
        out.push(`${pad}<${item.tag}/>${nl}`);
        continue;
      }
      out.push(`${pad}<${item.tag}>${nl}`);
      stack.push({ t: 'text', s: `${pad}</${item.tag}>${nl}` });
      for (let k = kids.length - 1; k >= 0; k -= 1) {
        const ki = kids[k];
        if (ki === undefined) continue;
        const child = nodes[ki];
        if (!child) continue;
        // Array elements have no key of their own: XML repeats the parent's
        // tag name, which is exactly how XML models a list. That collapsing
        // rule is shown, not hidden (design §4.6).
        let tag = item.tag;
        if (child.key !== null) {
          const named = xmlName(child.key);
          tag = named.name;
          if (named.changed) renamed.add(`«${child.key}» → «${named.name}»`);
        } else if (node.kind === 'array') {
          tag = singular(item.tag);
        }
        stack.push({ t: 'node', i: ki, depth: item.depth + 1, tag });
      }
      continue;
    }

    // Scalar
    if (node.kind === 'null') {
      nullCount += 1;
      out.push(`${pad}<${item.tag}/>${nl}`);
      continue;
    }
    const value = decodeScalar(node.raw);
    out.push(`${pad}<${item.tag}>${escapeXmlText(value)}</${item.tag}>${nl}`);
  }

  if (renamed.size > 0) {
    warnings.push({
      severity: 'warn',
      message: `XML: ${renamed.size} ключ(ей) не могут быть именами тегов (цифра в начале, пробел, спецсимвол) и переименованы: ${[...renamed].slice(0, 8).join(', ')}${renamed.size > 8 ? ' …' : ''}`,
    });
  }
  if (nullCount > 0) {
    warnings.push({
      severity: 'warn',
      message: `XML: ${nullCount} значение(й) null записаны пустым элементом — XML не различает «пусто» и «null». Обратное преобразование вернёт пустую строку, а не null.`,
    });
  }
  warnings.push({
    severity: 'warn',
    message:
      'XML: типы теряются. Числа, булевы и строки становятся текстом; при обратном преобразовании всё вернётся строками.',
  });
  warnings.push({
    severity: 'warn',
    message:
      'XML: элементы массива повторяют один тег. Массив из одного элемента при обратном разборе прочитается как одиночное значение, а не массив.',
  });

  return { text: out.join(''), warnings };
}

function singular(tag: string): string {
  return tag.endsWith('s') && tag.length > 1 ? tag.slice(0, -1) : `${tag}_item`;
}

/** `raw` is JSON text; turn it back into a display string for XML/CSV cells. */
function decodeScalar(raw: string | null): string {
  if (raw === null) return '';
  if (raw.startsWith('"')) {
    try {
      return String(JSON.parse(raw));
    } catch {
      return raw;
    }
  }
  return raw;
}

/* --------------------------------------------------------------------------
 * CSV shaping. CSV is a FLAT TABLE — a nested document simply does not fit,
 * and emitting an empty CSV would be the silent data loss the design forbids
 * (§4.6). Instead we detect the shape and, when it is wrong, hand back real
 * candidate paths taken from the document.
 * ------------------------------------------------------------------------ */

export interface CsvShape {
  ok: boolean;
  /** Rows of flat scalar cells, when ok. */
  rows: Record<string, string>[];
  columns: string[];
  warnings: ConversionWarning[];
  /** JSONPaths of arrays-of-objects found in the document, when not ok. */
  candidates: string[];
}

export function shapeForCsv(
  nodes: FlatNode[],
  pathOfNode: (i: number) => string,
): CsvShape {
  const warnings: ConversionWarning[] = [];
  const root = nodes[0];
  if (!root) {
    return { ok: false, rows: [], columns: [], warnings, candidates: [] };
  }

  const arrayIndex = root.kind === 'array' ? 0 : -1;
  if (arrayIndex === -1) {
    return {
      ok: false,
      rows: [],
      columns: [],
      warnings,
      candidates: findRowArrays(nodes, pathOfNode),
    };
  }

  const rowIdx = childrenOf(nodes, arrayIndex);
  const columns: string[] = [];
  const rows: Record<string, string>[] = [];
  let dropped = 0;

  for (const ri of rowIdx) {
    const rowNode = nodes[ri];
    if (!rowNode) continue;
    if (rowNode.kind !== 'object') {
      return {
        ok: false,
        rows: [],
        columns: [],
        warnings,
        candidates: findRowArrays(nodes, pathOfNode),
      };
    }
    // Null-proto: cell keys come from the document, so a key like `__proto__`
    // on a plain `{}` would reparent the row instead of becoming an own property
    // and the column would silently disappear. Object.create(null) has no
    // prototype to hijack; papaparse reads rows by explicit column, so this is
    // transparent downstream.
    const row: Record<string, string> = Object.create(null);
    for (const ci of childrenOf(nodes, ri)) {
      const cell = nodes[ci];
      if (!cell || cell.key === null) continue;
      if (cell.kind === 'object' || cell.kind === 'array') {
        dropped += 1;
        row[cell.key] = emitJson(subtree(nodes, ci), { indent: '', sortKeys: false });
      } else {
        row[cell.key] = decodeScalar(cell.raw);
      }
      if (!columns.includes(cell.key)) columns.push(cell.key);
    }
    rows.push(row);
  }

  if (dropped > 0) {
    warnings.push({
      severity: 'warn',
      message: `CSV: ${dropped} вложенных значений не помещаются в ячейку таблицы и записаны как строка JSON. Структура потеряна.`,
    });
  }
  warnings.push({
    severity: 'warn',
    message:
      'CSV: типы теряются — всё становится текстом. Числа, булевы, null и пустая строка станут неразличимы при обратном разборе.',
  });

  return { ok: true, rows, columns, warnings, candidates: [] };
}

/** A standalone copy of node `i`'s subtree, re-based so index 0 is the root. */
export function subtree(nodes: FlatNode[], i: number): FlatNode[] {
  const root = nodes[i];
  if (!root) return [];
  const slice = nodes.slice(i, i + root.subtree + 1);
  return slice.map((n, k) => ({
    ...n,
    parent: k === 0 ? -1 : n.parent - i,
    depth: n.depth - root.depth,
  }));
}

/** Real candidate arrays-of-objects, so "CSV doesn't fit" comes with a way out. */
export function findRowArrays(
  nodes: FlatNode[],
  pathOfNode: (i: number) => string,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < nodes.length && out.length < 6; i += 1) {
    const node = nodes[i];
    if (!node || node.kind !== 'array' || node.subtree === 0) continue;
    const kids = childrenOf(nodes, i);
    if (kids.length === 0) continue;
    const allObjects = kids.every((k) => nodes[k]?.kind === 'object');
    if (allObjects) out.push(pathOfNode(i));
  }
  return out;
}

/* --------------------------------------------------------------------------
 * YAML / JSON5 loss analysis (the serialisers themselves are the libraries').
 * ------------------------------------------------------------------------ */

const YAML11_AMBIGUOUS = /^(y|yes|n|no|on|off|true|false)$/i;

export function yamlWarnings(nodes: FlatNode[]): ConversionWarning[] {
  const warnings: ConversionWarning[] = [];
  let ambiguous = 0;
  let bigNums = 0;
  for (const node of nodes) {
    if (node.kind === 'string' && node.raw) {
      const s = decodeScalar(node.raw);
      if (YAML11_AMBIGUOUS.test(s)) ambiguous += 1;
    }
    if (node.kind === 'number' && node.raw && !Number.isSafeInteger(Number(node.raw))) {
      bigNums += 1;
    }
  }
  if (ambiguous > 0) {
    warnings.push({
      severity: 'warn',
      message: `YAML: ${ambiguous} строк(и) вида «yes»/«no»/«on»/«off» будут прочитаны как boolean парсерами YAML 1.1. Мы выводим YAML 1.2, но чужой парсер может решить иначе.`,
    });
  }
  if (bigNums > 0) {
    warnings.push({
      severity: 'warn',
      message: `YAML: ${bigNums} числ(а) выходят за пределы точного целого JavaScript. При выводе они прошли через double — исходное написание сохраняется только в исходном документе.`,
    });
  }
  return warnings;
}

export function commentLossWarning(from: string): ConversionWarning[] {
  if (from !== 'jsonc') return [];
  return [
    {
      severity: 'warn',
      message:
        'JSONC: комментарии теряются при любой конвертации — ни один целевой формат их не переносит.',
    },
  ];
}
