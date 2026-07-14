import { useState } from 'react';
import { MockBadge } from '@blur/ui';
import { MOCK_RECENT_EMOJI } from '../utils/mock';
import type { Target } from '../utils/types';

// Emoji picker (design §2.4). Popover API, NOT a modal — top-layer, light-dismiss,
// Esc and focus management for free. The emoji DATA set is loaded lazily
// (`await import('emojibase-data/...')`) on first open and is NOT in the main
// bundle — stubbed here with a small mock list. The unicode/shortcode toggle is
// target-aware: Jira and Telegram don't understand shortcodes, so that radio is
// disabled for them with an explanation (design §2.4, never silently).

export function EmojiPicker({
  target,
  insertMode,
  onInsert,
}: {
  target: Target;
  insertMode: 'unicode' | 'shortcode';
  onInsert: (value: string) => void;
}) {
  const shortcodeUnsupported = target === 'jira' || target === 'telegram';
  const [mode, setMode] = useState<'unicode' | 'shortcode'>(
    shortcodeUnsupported ? 'unicode' : insertMode,
  );

  const value = (emoji: string, shortcode: string) =>
    mode === 'shortcode' && !shortcodeUnsupported ? shortcode : emoji;

  return (
    <div id="cw-emoji" popover="auto" className="cw-popover cw-emoji">
      <MockBadge note="Демо-набор эмодзи · реальные данные грузятся лениво (scaffold)" />
      <input
        type="search"
        className="cw-input"
        placeholder="поиск: rocket…"
        aria-label="Поиск эмодзи"
      />
      <p className="cw-emoji__group">Недавние</p>
      <div className="cw-emoji__grid">
        {MOCK_RECENT_EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            className="cw-emoji__btn"
            onClick={() => onInsert(value(e, ':emoji:'))}
            aria-label={`Вставить ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
      <p className="cw-emoji__group">Результаты «rocket»</p>
      <button type="button" className="cw-menu-item" onClick={() => onInsert(value('🚀', ':rocket:'))}>
        🚀 :rocket:
      </button>
      <button type="button" className="cw-menu-item" onClick={() => onInsert(value('🛸', ':flying_saucer:'))}>
        🛸 :flying_saucer:
      </button>
      <fieldset className="cw-emoji__mode">
        <legend>Вставить как:</legend>
        <label>
          <input
            type="radio"
            name="cw-emoji-mode"
            checked={mode === 'unicode'}
            onChange={() => setMode('unicode')}
          />{' '}
          Символ 🚀
        </label>
        <label>
          <input
            type="radio"
            name="cw-emoji-mode"
            checked={mode === 'shortcode'}
            disabled={shortcodeUnsupported}
            onChange={() => setMode('shortcode')}
          />{' '}
          Шорткод :rocket:
        </label>
        {shortcodeUnsupported && (
          <p className="cw-hint">
            ⚠️ {target === 'jira' ? 'Jira' : 'Telegram'} шорткоды не понимает — вставится символ 🚀
          </p>
        )}
      </fieldset>
    </div>
  );
}
