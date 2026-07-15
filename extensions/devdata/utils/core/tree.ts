// The flat, virtualisable document tree — the single in-memory representation
// every surface renders from (design §2.4, §5.2).
//
// Two hard requirements shape this file:
//
//  1. NO RECURSION. A 50 MB document can nest thousands of levels deep and a
//     recursive walker would blow the JS stack (an unhandled RangeError = the
//     silent blank screen the design forbids, §8). Every walker here is an
//     explicit-stack loop.
//  2. EXACT SOURCE TEXT. Scalars carry `raw` — the characters as they appear in
//     the document. That is what lets the inspector show
//     `12345678901234567890` instead of the double-rounded
//     `12345678901234567000` (design §2.4, the PLAN.md (Часть II) §10.1 differentiator).
//
// The tree is stored PRE-ORDER and flat: node `i`'s descendants are exactly
// `[i+1 .. i+subtree]`. That single invariant gives O(1) subtree skipping (for
// collapse), O(children) child enumeration, and a serializer that never
// recurses.

export type Kind = 'object' | 'array' | 'string' | 'number' | 'bool' | 'null';

export interface FlatNode {
  /** Index of the parent node, or -1 at the root. */
  parent: number;
  depth: number;
  kind: Kind;
  /** Object property name; null for array elements and the root. */
  key: string | null;
  /** Array index; null when the node is not an array element. */
  index: number | null;
  /** Short, already-truncated display text. */
  preview: string;
  /** Child count for containers, else null. */
  count: number | null;
  /** Number of descendants (pre-order): descendants are [i+1 .. i+subtree]. */
  subtree: number;
  /**
   * Exact scalar text. For JSON/JSONC this is sliced straight out of the source,
   * so big integers keep every digit. For value-derived trees (YAML/XML/CSV/
   * JSON5) it is the JSON spelling of the value. null for containers.
   */
  raw: string | null;
  /** 1-based source line, when the parser gave us offsets. */
  line: number | null;
}

/** Hard caps. Beyond these we stop building and say so — never hang, never lie. */
export const MAX_NODES = 400_000;
export const MAX_DEPTH = 512;

export interface TreeResult {
  nodes: FlatNode[];
  /** True when MAX_NODES / MAX_DEPTH cut the walk short (surfaced in the UI). */
  truncated: boolean;
  /** True when at least one number cannot round-trip through a JS double. */
  bigNumbers: boolean;
}

const MAX_PREVIEW = 72;

function clip(s: string): string {
  return s.length > MAX_PREVIEW ? `${s.slice(0, MAX_PREVIEW - 1)}…` : s;
}

/**
 * Does this number's SOURCE SPELLING survive a JS double round-trip?
 * `12345678901234567890` does not — JavaScript would hand back
 * `12345678901234567000`, and showing that as if it were the document is the
 * exact lie the design forbids (§5.6, §6.3).
 */
export function losesPrecision(raw: string): boolean {
  const n = Number(raw);
  if (!Number.isFinite(n)) return true; // e.g. 1e400 → Infinity
  if (/^-?\d+$/.test(raw)) {
    // Integers: BigInt comparison is exact. BigInt(double) is safe here because
    // a finite double parsed from an integer literal is integer-valued.
    try {
      return BigInt(raw) !== BigInt(n);
    } catch {
      return true;
    }
  }
  // Fractions always lose *something*; only flag when the source carries more
  // significant digits than a double can represent at all.
  const digits = raw.replace(/[-+.eE]/g, '').replace(/^0+/, '');
  return digits.length > 17;
}

function scalarKind(v: unknown): Kind {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
      return 'string';
    case 'number':
    case 'bigint':
      return 'number';
    case 'boolean':
      return 'bool';
    default:
      return 'string';
  }
}

function scalarRaw(v: unknown): string {
  if (v === undefined) return 'null';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number' && !Number.isFinite(v)) return 'null'; // JSON has no NaN/Infinity
  try {
    return JSON.stringify(v) ?? 'null';
  } catch {
    return String(v);
  }
}

/* --------------------------------------------------------------------------
 * Value-derived tree (YAML / XML / CSV / JSON5 — parsers that hand back a
 * plain JS value with no offsets).
 * ------------------------------------------------------------------------ */

type ValueFrame =
  | { close: number; obj: object }
  | {
      value: unknown;
      key: string | null;
      index: number | null;
      parent: number;
      depth: number;
    };

export function buildTreeFromValue(root: unknown): TreeResult {
  const nodes: FlatNode[] = [];
  let truncated = false;
  let bigNumbers = false;
  const stack: ValueFrame[] = [
    { value: root, key: null, index: null, parent: -1, depth: 0 },
  ];
  // Cycle guard. A parser's output should be acyclic, but a YAML anchor can
  // alias its own ancestor (`&a { self: *a }`) — walking that would spin
  // forever (billion-laughs by another name, design §4.6). `onPath` holds only
  // the CURRENT ancestor chain, so shared-but-acyclic aliases still expand.
  const onPath = new Set<object>();

  while (stack.length > 0) {
    const frame = stack.pop() as ValueFrame;
    if ('close' in frame) {
      const node = nodes[frame.close];
      if (node) node.subtree = nodes.length - frame.close - 1;
      onPath.delete(frame.obj);
      continue;
    }

    if (nodes.length >= MAX_NODES) {
      truncated = true;
      break;
    }

    const { value, key, index, parent, depth } = frame;
    const i = nodes.length;
    const isArray = Array.isArray(value);
    const isObject = !isArray && value !== null && typeof value === 'object';

    if (isArray || isObject) {
      const obj = value as object;
      if (onPath.has(obj)) {
        nodes.push({
          parent,
          depth,
          kind: 'string',
          key,
          index,
          preview: '↺ циклическая ссылка — раскрытие остановлено',
          count: null,
          subtree: 0,
          raw: '"[circular]"',
          line: null,
        });
        continue;
      }
      const entries: [string, unknown][] = isArray
        ? []
        : Object.entries(value as Record<string, unknown>);
      const count = isArray ? (value as unknown[]).length : entries.length;
      nodes.push({
        parent,
        depth,
        kind: isArray ? 'array' : 'object',
        key,
        index,
        preview: isArray ? `[…] ${count}` : `{…} ${count}`,
        count,
        subtree: 0,
        raw: null,
        line: null,
      });

      if (count === 0 || depth >= MAX_DEPTH) {
        if (depth >= MAX_DEPTH && count > 0) truncated = true;
        continue;
      }
      onPath.add(obj);
      stack.push({ close: i, obj });
      for (let k = count - 1; k >= 0; k -= 1) {
        if (isArray) {
          stack.push({
            value: (value as unknown[])[k],
            key: null,
            index: k,
            parent: i,
            depth: depth + 1,
          });
        } else {
          const entry = entries[k];
          if (!entry) continue;
          stack.push({
            value: entry[1],
            key: entry[0],
            index: null,
            parent: i,
            depth: depth + 1,
          });
        }
      }
      continue;
    }

    const raw = scalarRaw(value);
    const kind = scalarKind(value);
    if (kind === 'number' && losesPrecision(raw)) bigNumbers = true;
    nodes.push({
      parent,
      depth,
      kind,
      key,
      index,
      preview: clip(raw),
      count: null,
      subtree: 0,
      raw,
      line: null,
    });
  }

  return { nodes, truncated, bigNumbers };
}

/* --------------------------------------------------------------------------
 * jsonc-parser-derived tree (JSON / JSONC) — the offset-carrying path.
 * ------------------------------------------------------------------------ */

/** The shape of a `jsonc-parser` AST node (structurally typed so this module
 *  stays importable without the library — the worker passes the real thing). */
export interface JsoncNode {
  type: 'object' | 'array' | 'property' | 'string' | 'number' | 'boolean' | 'null';
  offset: number;
  length: number;
  value?: unknown;
  children?: JsoncNode[];
}

type JsoncFrame =
  | { close: number }
  | {
      node: JsoncNode;
      key: string | null;
      index: number | null;
      parent: number;
      depth: number;
    };

/** Line-start offsets for O(log n) offset → line lookups. */
export function lineStartsOf(text: string): Int32Array {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return Int32Array.from(starts);
}

export function lineOf(lineStarts: Int32Array, offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-based
}

export function buildTreeFromJsonc(
  root: JsoncNode,
  text: string,
  lineStarts: Int32Array,
): TreeResult {
  const nodes: FlatNode[] = [];
  let truncated = false;
  let bigNumbers = false;
  const stack: JsoncFrame[] = [
    { node: root, key: null, index: null, parent: -1, depth: 0 },
  ];

  while (stack.length > 0) {
    const frame = stack.pop() as JsoncFrame;
    if ('close' in frame) {
      const node = nodes[frame.close];
      if (node) node.subtree = nodes.length - frame.close - 1;
      continue;
    }
    if (nodes.length >= MAX_NODES) {
      truncated = true;
      break;
    }

    const { node, key, index, parent, depth } = frame;
    const i = nodes.length;
    const line = lineOf(lineStarts, node.offset);

    if (node.type === 'object' || node.type === 'array') {
      const children = node.children ?? [];
      const count = children.length;
      nodes.push({
        parent,
        depth,
        kind: node.type,
        key,
        index,
        preview: node.type === 'array' ? `[…] ${count}` : `{…} ${count}`,
        count,
        subtree: 0,
        raw: null,
        line,
      });
      if (count === 0 || depth >= MAX_DEPTH) {
        if (depth >= MAX_DEPTH && count > 0) truncated = true;
        continue;
      }
      stack.push({ close: i });
      for (let k = count - 1; k >= 0; k -= 1) {
        const child = children[k];
        if (!child) continue;
        if (node.type === 'object') {
          // property node: children[0] = key, children[1] = value
          const kv = child.children ?? [];
          const keyNode = kv[0];
          const valueNode = kv[1];
          if (!valueNode) continue;
          stack.push({
            node: valueNode,
            key: String(keyNode?.value ?? ''),
            index: null,
            parent: i,
            depth: depth + 1,
          });
        } else {
          stack.push({
            node: child,
            key: null,
            index: k,
            parent: i,
            depth: depth + 1,
          });
        }
      }
      continue;
    }

    // Scalar: slice the EXACT source text (this is the whole point).
    const raw = text.slice(node.offset, node.offset + node.length);
    const kind: Kind =
      node.type === 'boolean'
        ? 'bool'
        : node.type === 'number'
          ? 'number'
          : node.type === 'null'
            ? 'null'
            : 'string';
    if (kind === 'number' && losesPrecision(raw)) bigNumbers = true;
    nodes.push({
      parent,
      depth,
      kind,
      key,
      index,
      preview: clip(raw),
      count: null,
      subtree: 0,
      raw,
      line,
    });
  }

  return { nodes, truncated, bigNumbers };
}

/* --------------------------------------------------------------------------
 * Navigation helpers (all iterative)
 * ------------------------------------------------------------------------ */

/** Direct children of node `i`, using the pre-order subtree invariant. */
export function childrenOf(nodes: FlatNode[], i: number): number[] {
  const parent = nodes[i];
  if (!parent || parent.subtree === 0) return [];
  const out: number[] = [];
  let j = i + 1;
  const end = i + parent.subtree;
  while (j <= end) {
    out.push(j);
    const child = nodes[j];
    if (!child) break;
    j += 1 + child.subtree;
  }
  return out;
}

/** JSONPath (`$.users[1].id`) for node `i`, walked up through parents. */
export function pathOf(nodes: FlatNode[], i: number): string {
  const parts: string[] = [];
  let cur = i;
  while (cur >= 0) {
    const node = nodes[cur];
    if (!node) break;
    if (node.index !== null) parts.push(`[${node.index}]`);
    else if (node.key !== null) parts.push(`.${node.key}`);
    cur = node.parent;
  }
  parts.push('$');
  return parts.reverse().join('');
}

/** Resolve a JSONPath back to a node index, or -1. Iterative, no eval. */
export function findByPath(nodes: FlatNode[], path: string): number {
  if (nodes.length === 0) return -1;
  const steps = parsePath(path);
  if (steps === null) return -1;
  let cur = 0;
  for (const step of steps) {
    const kids = childrenOf(nodes, cur);
    let next = -1;
    for (const k of kids) {
      const node = nodes[k];
      if (!node) continue;
      if (typeof step === 'number' ? node.index === step : node.key === step) {
        next = k;
        break;
      }
    }
    if (next === -1) return -1;
    cur = next;
  }
  return cur;
}

/** `$.a[0].b` → ['a', 0, 'b']. Returns null when the path is not well-formed. */
export function parsePath(path: string): (string | number)[] | null {
  const trimmed = path.trim();
  if (!trimmed.startsWith('$')) return null;
  const steps: (string | number)[] = [];
  let i = 1;
  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === '.') {
      i += 1;
      let key = '';
      while (i < trimmed.length && trimmed[i] !== '.' && trimmed[i] !== '[') {
        key += trimmed[i];
        i += 1;
      }
      if (key === '') return null;
      steps.push(key);
    } else if (ch === '[') {
      const close = trimmed.indexOf(']', i);
      if (close === -1) return null;
      const inner = trimmed.slice(i + 1, close);
      if (/^\d+$/.test(inner)) steps.push(Number(inner));
      else if (/^'.*'$/.test(inner) || /^".*"$/.test(inner))
        steps.push(inner.slice(1, -1));
      else return null;
      i = close + 1;
    } else {
      return null;
    }
  }
  return steps;
}

/**
 * The rows currently visible given a set of expanded container indices.
 * Collapsed subtrees are skipped in O(1) thanks to `subtree` — this is what
 * keeps a 400 000-node tree interactive.
 */
export function visibleRows(nodes: FlatNode[], expanded: Set<number>): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (!node) break;
    out.push(i);
    if (node.subtree > 0 && !expanded.has(i)) i += 1 + node.subtree;
    else i += 1;
  }
  return out;
}

/** Containers up to `depth` levels deep — the initial expansion (pref, §3). */
export function expandToDepth(nodes: FlatNode[], depth: number): Set<number> {
  const set = new Set<number>();
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) break;
    if (node.subtree > 0 && node.depth < depth) set.add(i);
  }
  return set;
}

/**
 * Rebuild a plain JS value from the flat tree — needed by the YAML/CSV/JSON5
 * serialisers, which take a value rather than our node array.
 * Post-order via a backwards sweep (children always follow their parent in
 * pre-order), so there is no recursion here either.
 */
export function toValue(nodes: FlatNode[]): unknown {
  if (nodes.length === 0) return null;
  const built: unknown[] = new Array(nodes.length);
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (!node) continue;
    if (node.kind === 'object') {
      // Null-proto: document keys are user-controlled, and a key like `__proto__`
      // assigned onto a plain `{}` would reparent the object instead of becoming
      // an own property — the key would silently vanish. Object.create(null) has
      // no prototype to hijack, so every key survives as an own property.
      const obj: Record<string, unknown> = Object.create(null);
      for (const c of childrenOf(nodes, i)) obj[nodes[c]?.key ?? ''] = built[c];
      built[i] = obj;
    } else if (node.kind === 'array') {
      built[i] = childrenOf(nodes, i).map((c) => built[c]);
    } else if (node.kind === 'number') {
      built[i] = Number(node.raw);
    } else if (node.kind === 'bool') {
      built[i] = node.raw === 'true';
    } else if (node.kind === 'null') {
      built[i] = null;
    } else {
      try {
        built[i] = node.raw === null ? '' : (JSON.parse(node.raw) as string);
      } catch {
        built[i] = node.raw;
      }
    }
  }
  return built[0];
}

/** Every ancestor of `i` — used to reveal a node found by search/validation. */
export function ancestorsOf(nodes: FlatNode[], i: number): number[] {
  const out: number[] = [];
  let cur = nodes[i]?.parent ?? -1;
  while (cur >= 0) {
    out.push(cur);
    cur = nodes[cur]?.parent ?? -1;
  }
  return out;
}
