// The tokenizer behind the syntax colouring.
//
// It returns nothing but OFFSET RANGES. It never builds markup. That is the
// whole point (design §7.3, PLAN.md (Часть II) §10.1): colouring is applied with the CSS
// Custom Highlight API over `Range`s on ONE flat text node, so
//   - there is no HTML-injection surface at all — user text is never turned
//     into elements, and
//   - a 50 MB document does not become 40 000 `<span>`s (highlight.js / Prism
//     are explicitly refused).
//
// Only the ~200 visible lines are ever tokenised, so this stays cheap no matter
// how big the document is.

export type TokenType =
  | 'key'
  | 'string'
  | 'number'
  | 'bool'
  | 'null'
  | 'punct'
  | 'comment'
  | 'tag'
  | 'attr';

export interface Token {
  start: number;
  end: number;
  type: TokenType;
}

export type TokenizeFormat = 'json' | 'json5' | 'jsonc' | 'yaml' | 'xml' | 'csv';

/** Guard: never tokenise an unbounded window (the caller passes ~200 lines). */
const MAX_TOKENIZE = 400_000;

export function tokenize(text: string, format: TokenizeFormat): Token[] {
  if (text.length > MAX_TOKENIZE) return [];
  switch (format) {
    case 'json':
    case 'json5':
    case 'jsonc':
      return tokenizeJsonLike(text);
    case 'yaml':
      return tokenizeYaml(text);
    case 'xml':
      return tokenizeXml(text);
    case 'csv':
      return [];
  }
}

/**
 * A hand-rolled JSON/JSON5/JSONC scanner. `jsonc-parser`'s scanner would do the
 * JSON/JSONC half, but it cannot see JSON5 (single quotes, unquoted keys, hex)
 * and pulling a 14 KB parser into the hot rendering path to tokenise 200 lines
 * is not worth it. This is ~80 lines and covers all three.
 */
function tokenizeJsonLike(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i] as string;

    // Whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }

    // Comments (JSONC / JSON5)
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      tokens.push({ start: i, end: end === -1 ? n : end, type: 'comment' });
      i = end === -1 ? n : end;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      tokens.push({ start: i, end: stop, type: 'comment' });
      i = stop;
      continue;
    }

    // Strings (double or single-quoted; JSON5 allows both)
    if (c === '"' || c === "'") {
      const start = i;
      const quote = c;
      i += 1;
      while (i < n) {
        const ch = text[i];
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      // A string followed by `:` is a KEY. That, plus the quotes and the colon,
      // is how keys stay distinguishable — `::highlight()` cannot change
      // font-weight (design §9.1), so we never rely on bold.
      const isKey = nextNonSpaceIs(text, i, ':');
      tokens.push({ start, end: i, type: isKey ? 'key' : 'string' });
      continue;
    }

    // Numbers (incl. JSON5 hex / leading dot / +)
    if (c === '-' || c === '+' || c === '.' || (c >= '0' && c <= '9')) {
      const start = i;
      i += 1;
      while (i < n && /[0-9a-fA-FxXeE+.\-_]/.test(text[i] as string)) i += 1;
      tokens.push({ start, end: i, type: 'number' });
      continue;
    }

    // Literals + JSON5 unquoted keys
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < n && /[\w$]/.test(text[i] as string)) i += 1;
      const word = text.slice(start, i);
      const type: TokenType = nextNonSpaceIs(text, i, ':')
        ? 'key'
        : word === 'true' || word === 'false'
          ? 'bool'
          : word === 'null' || word === 'undefined'
            ? 'null'
            : 'string';
      tokens.push({ start, end: i, type });
      continue;
    }

    // Structure
    if ('{}[],:'.includes(c)) {
      tokens.push({ start: i, end: i + 1, type: 'punct' });
      i += 1;
      continue;
    }

    i += 1;
  }

  return tokens;
}

function nextNonSpaceIs(text: string, from: number, ch: string): boolean {
  let i = from;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === ' ' || c === '\t' || c === '\r') {
      i += 1;
      continue;
    }
    return c === ch;
  }
  return false;
}

function tokenizeYaml(text: string): Token[] {
  const tokens: Token[] = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd);

    const hash = line.indexOf('#');
    const codeEnd = hash === -1 ? line.length : hash;
    if (hash !== -1) {
      tokens.push({ start: lineStart + hash, end: lineEnd, type: 'comment' });
    }

    const code = line.slice(0, codeEnd);
    const keyMatch = /^(\s*(?:-\s+)?)([\w."'[\]/@ -]+?):(\s|$)/.exec(code);
    if (keyMatch) {
      const keyStart = lineStart + (keyMatch[1] as string).length;
      tokens.push({
        start: keyStart,
        end: keyStart + (keyMatch[2] as string).length,
        type: 'key',
      });
      const valueStart = keyStart + (keyMatch[2] as string).length + 1;
      const value = code.slice(valueStart - lineStart).trim();
      if (value !== '') {
        const vs = lineStart + code.indexOf(value, valueStart - lineStart);
        tokens.push({
          start: vs,
          end: vs + value.length,
          type: yamlValueType(value),
        });
      }
    }

    lineStart = lineEnd + 1;
    if (lineEnd === text.length) break;
  }
  return tokens;
}

function yamlValueType(v: string): TokenType {
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'number';
  if (/^(true|false|yes|no|on|off)$/i.test(v)) return 'bool';
  if (/^(null|~)$/i.test(v)) return 'null';
  return 'string';
}

function tokenizeXml(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /<!--[\s\S]*?-->|<\/?([\w:.-]+)|([\w:.-]+)=("[^"]*"|'[^']*')|[<>/?]/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[0].startsWith('<!--')) {
      tokens.push({ start, end, type: 'comment' });
    } else if (m[1] !== undefined) {
      tokens.push({ start, end, type: 'tag' });
    } else if (m[2] !== undefined) {
      const eq = start + (m[2] as string).length;
      tokens.push({ start, end: eq, type: 'attr' });
      tokens.push({ start: eq + 1, end, type: 'string' });
    } else {
      tokens.push({ start, end, type: 'punct' });
    }
    m = re.exec(text);
  }
  return tokens;
}
