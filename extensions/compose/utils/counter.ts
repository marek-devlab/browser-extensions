// Character / word counter (design §2.7, §10.1). ✅ REAL — not mocked.
//
// This is small and correct, so it ships for real in the scaffold. `Intl.Segmenter`
// is the ONLY correct way to count what a human sees: `granularity: 'grapheme'`
// treats "👍" as 1 symbol (not 2 UTF-16, not 4 bytes) and "🇺🇦" as 1 (not 2), and
// `granularity: 'word'` counts words correctly for Cyrillic too. `.length` (UTF-16
// code units) and `TextEncoder` (UTF-8 bytes) are also exposed because DB/HTTP
// limits are in bytes and X counts ~code points — showing a single number would
// be lying (design §2.7).

export interface Counts {
  graphemes: number;
  utf16: number;
  bytes: number;
  codepoints: number;
  words: number;
  lines: number;
  paragraphs: number;
  /** minutes, rounded up, at ~200 wpm */
  readingMinutes: number;
  /** true when Intl.Segmenter is unavailable and graphemes is a code-point approx */
  approximate: boolean;
}

const encoder = new TextEncoder();

let graphemeSeg: Intl.Segmenter | null = null;
let wordSeg: Intl.Segmenter | null = null;
try {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    graphemeSeg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    wordSeg = new Intl.Segmenter(undefined, { granularity: 'word' });
  }
} catch {
  // Leave null → fall back to code-point counting, flagged `approximate`.
}

function countGraphemes(text: string): { count: number; approximate: boolean } {
  if (graphemeSeg) {
    let n = 0;
    for (const _ of graphemeSeg.segment(text)) n++;
    return { count: n, approximate: false };
  }
  // Baseline says Segmenter is always present; if not, count code points and be
  // HONEST that it's approximate rather than silently returning `.length`.
  return { count: [...text].length, approximate: true };
}

function countWords(text: string): number {
  if (wordSeg) {
    let n = 0;
    for (const s of wordSeg.segment(text)) if (s.isWordLike) n++;
    return n;
  }
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Full stats for a piece of text (whole draft or the current selection). */
export function countText(text: string): Counts {
  const { count: graphemes, approximate } = countGraphemes(text);
  const lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
  const paragraphs = text.trim() === '' ? 0 : text.trim().split(/\n\s*\n/).length;
  const words = countWords(text);
  return {
    graphemes,
    utf16: text.length,
    bytes: encoder.encode(text).length,
    codepoints: [...text].length,
    words,
    lines,
    paragraphs,
    readingMinutes: Math.max(1, Math.ceil(words / 200)),
    approximate,
  };
}
