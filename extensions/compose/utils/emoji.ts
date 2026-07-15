// Emoji data (design §2.4, §10.2).
//
// ⚠️ WEIGHT IS THE WHOLE PROBLEM. The full emojibase set with shortcodes is
// hundreds of KB — it must NEVER land in the main bundle (the panel is 320 px
// wide and a slow start is instantly visible). So:
//   1. the data is behind `await import()` → its own lazy chunk, fetched on the
//      first open of the picker;
//   2. only `en` + one shortcode preset is loaded (no skin-tone variants, no
//      translations, no descriptions);
//   3. the search index is built at runtime, not bundled.
// Zero network: the JSON is bundled into the extension, `await import()` loads a
// local chunk (design §7.4 — `connect-src 'none'` makes a CDN impossible anyway).

export interface EmojiEntry {
  /** The Unicode character, e.g. "🚀". */
  char: string;
  /** The GitHub/Slack-style shortcode WITHOUT colons, e.g. "rocket". */
  shortcode: string;
  label: string;
  /** Lowercased haystack: label + tags + shortcode. */
  search: string;
}

export interface EmojiIndex {
  all: EmojiEntry[];
  /** shortcode (no colons) → character. Used by the Jira/Telegram converter. */
  byShortcode: Map<string, string>;
}

interface CompactEmoji {
  hexcode: string;
  label: string;
  unicode: string;
  tags?: string[];
}

let cache: Promise<EmojiIndex> | null = null;

/** Load (once) and index the emoji set. Rejects only on a chunk-load failure —
 *  the picker surfaces that with a Retry (design §8.5). */
export function loadEmoji(): Promise<EmojiIndex> {
  cache ??= build().catch((e) => {
    cache = null; // let Retry try again
    throw e;
  });
  return cache;
}

async function build(): Promise<EmojiIndex> {
  const [compactMod, shortcodeMod] = await Promise.all([
    import('emojibase-data/en/compact.json'),
    import('emojibase-data/en/shortcodes/github.json'),
  ]);
  const compact = (compactMod.default ?? compactMod) as unknown as CompactEmoji[];
  const shortcodes = (shortcodeMod.default ?? shortcodeMod) as unknown as Record<
    string,
    string | string[]
  >;

  const all: EmojiEntry[] = [];
  const byShortcode = new Map<string, string>();

  for (const e of compact) {
    const raw = shortcodes[e.hexcode];
    if (!raw) continue;
    const codes = Array.isArray(raw) ? raw : [raw];
    const primary = codes[0];
    if (!primary) continue;
    for (const c of codes) if (!byShortcode.has(c)) byShortcode.set(c, e.unicode);
    all.push({
      char: e.unicode,
      shortcode: primary,
      label: e.label,
      search: `${e.label} ${codes.join(' ')} ${(e.tags ?? []).join(' ')}`.toLowerCase(),
    });
  }

  return { all, byShortcode };
}

/** Simple substring ranking: exact shortcode first, then prefix, then anywhere. */
export function searchEmoji(index: EmojiIndex, query: string, limit = 40): EmojiEntry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const out: EmojiEntry[] = [];
  const prefix: EmojiEntry[] = [];
  const rest: EmojiEntry[] = [];
  for (const e of index.all) {
    if (e.shortcode === q) out.push(e);
    else if (e.shortcode.startsWith(q) || e.label.toLowerCase().startsWith(q)) prefix.push(e);
    else if (e.search.includes(q)) rest.push(e);
    if (out.length + prefix.length + rest.length >= limit * 3) break;
  }
  return [...out, ...prefix, ...rest].slice(0, limit);
}

/** Default "recent" set before the user has picked anything (design §2.4). */
export const DEFAULT_RECENT = ['🚀', '🐛', '✅', '⚠️', '🎉', '👍', '🔥', '📌'];
