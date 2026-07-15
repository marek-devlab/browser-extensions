import { useEffect, useRef, useState } from 'react';
import { Button, Spinner } from '@blur/ui';
import { DEFAULT_RECENT, loadEmoji, searchEmoji, type EmojiEntry, type EmojiIndex } from '../utils/emoji';
import { recentEmojiItem } from '../utils/storage';
import type { Target } from '../utils/types';

// Emoji picker (design §2.4). Popover API, NOT a modal — top-layer, light-dismiss,
// Esc and focus management for free.
//
// ⚠️ The emoji DATA is loaded LAZILY on first open (`await import()`), so the
// hundreds of KB never enter the main bundle (design §10.2). A chunk-load failure
// is shown with a Retry — the editor keeps working (design §8.5).
//
// ⚠️ CSS Anchor Positioning is Baseline `limited` / Chromium-only, so the popover
// is positioned by plain CSS (pinned to the panel edge) and anchoring is only a
// progressive enhancement behind @supports (design §2.4).
//
// The unicode/shortcode toggle is TARGET-AWARE: Jira and Telegram do not
// understand `:rocket:`, so that radio is disabled for them WITH an explanation —
// never silently swapped behind the user's back (design §2.4, §5).

export function EmojiPicker({
  target,
  insertMode,
  onInsert,
  onModeChange,
}: {
  target: Target;
  insertMode: 'unicode' | 'shortcode';
  onInsert: (value: string) => void;
  onModeChange: (mode: 'unicode' | 'shortcode') => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState<EmojiIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(DEFAULT_RECENT);

  const shortcodeUnsupported = target === 'jira' || target === 'telegram';
  const mode = shortcodeUnsupported ? 'unicode' : insertMode;

  const load = () => {
    if (index || loading) return;
    setLoading(true);
    setError(false);
    loadEmoji()
      .then((i) => setIndex(i))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void recentEmojiItem
      .getValue()
      .then((r) => {
        if (r.length > 0) setRecent(r);
      })
      .catch(() => {});
  }, []);

  // The data must not load until the picker is actually opened.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onToggle = (ev: Event) => {
      if ((ev as Event & { newState?: string }).newState === 'open') load();
    };
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  });

  const insert = (entry: { char: string; shortcode?: string }) => {
    const value =
      mode === 'shortcode' && entry.shortcode ? `:${entry.shortcode}:` : entry.char;
    onInsert(value);
    const next = [entry.char, ...recent.filter((c) => c !== entry.char)].slice(0, 16);
    setRecent(next);
    void recentEmojiItem.setValue(next).catch(() => {});
    ref.current?.hidePopover?.();
  };

  const results: EmojiEntry[] = index && query.trim() ? searchEmoji(index, query) : [];

  return (
    <div ref={ref} id="cw-emoji" popover="auto" className="cw-popover cw-emoji">
      <input
        type="search"
        className="cw-input"
        placeholder="Поиск: rocket…"
        aria-label="Поиск эмодзи"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <p className="cw-emoji__group">Недавние</p>
      <div className="cw-emoji__grid">
        {recent.map((c) => (
          <button
            key={c}
            type="button"
            className="cw-emoji__btn"
            onClick={() => insert({ char: c, shortcode: findShortcode(index, c) })}
            aria-label={`Вставить ${c}`}
          >
            {c}
          </button>
        ))}
      </div>

      {loading && <Spinner label="Загрузка набора эмодзи…" />}

      {error && (
        <div role="alert" className="cw-invalid">
          <p>Не удалось загрузить набор эмодзи.</p>
          <Button onClick={load}>Повторить</Button>
        </div>
      )}

      {index && query.trim() !== '' && (
        <>
          <p className="cw-emoji__group">Результаты «{query}»</p>
          {results.length === 0 && <p className="cw-hint">Ничего не найдено.</p>}
          <div className="cw-emoji__results">
            {results.map((e) => (
              <button
                key={e.char + e.shortcode}
                type="button"
                className="cw-menu-item"
                onClick={() => insert(e)}
              >
                {e.char} :{e.shortcode}:
              </button>
            ))}
          </div>
        </>
      )}

      <fieldset className="cw-emoji__mode">
        <legend>Вставить как:</legend>
        <label>
          <input
            type="radio"
            name="cw-emoji-mode"
            checked={mode === 'unicode'}
            onChange={() => onModeChange('unicode')}
          />{' '}
          Символ 🚀
        </label>
        <label>
          <input
            type="radio"
            name="cw-emoji-mode"
            checked={mode === 'shortcode'}
            disabled={shortcodeUnsupported}
            onChange={() => onModeChange('shortcode')}
          />{' '}
          Шорткод :rocket:
        </label>
        {shortcodeUnsupported && (
          <p className="cw-hint">
            ⚠️ {target === 'jira' ? 'Jira' : 'Telegram'} шорткоды не понимает — вставится символ.
            При копировании оставшиеся в тексте шорткоды тоже станут символами.
          </p>
        )}
      </fieldset>
    </div>
  );
}

function findShortcode(index: EmojiIndex | null, char: string): string | undefined {
  if (!index) return undefined;
  return index.all.find((e) => e.char === char)?.shortcode;
}
