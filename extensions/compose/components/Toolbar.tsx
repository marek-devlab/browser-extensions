import type { ActionId } from '../utils/editor-actions';

// Editor toolbar (design §2.3). The buttons are REAL: each dispatches an
// `ActionId` that EditorPane applies via utils/editor-actions (pure string
// insertion into the draft). On a narrow panel the low-priority buttons collapse
// into a `⋯` popover; B, ☑, <>, ⌄, 😊 always stay (design §2.3).

interface ToolButton {
  id: ActionId | 'emoji' | 'more';
  glyph: string;
  label: string;
  /** Kept in the always-visible set on a ~320px panel. */
  primary: boolean;
}

const BUTTONS: ToolButton[] = [
  { id: 'bold', glyph: 'B', label: 'Жирный (Ctrl+B)', primary: true },
  { id: 'italic', glyph: 'I', label: 'Курсив (Ctrl+I)', primary: false },
  { id: 'strike', glyph: 'S̶', label: 'Зачёркнутый (Ctrl+Shift+X)', primary: false },
  { id: 'code', glyph: '<>', label: 'Код (Ctrl+E)', primary: true },
  { id: 'bullet', glyph: '•', label: 'Список (Ctrl+Shift+8)', primary: false },
  { id: 'ordered', glyph: '1.', label: 'Нумерованный список', primary: false },
  { id: 'task', glyph: '☑', label: 'Задача (Ctrl+Shift+C)', primary: true },
  { id: 'details', glyph: '⌄', label: '<details> (Ctrl+Shift+D)', primary: true },
  { id: 'table', glyph: '▦', label: 'Таблица (Ctrl+Shift+T)', primary: false },
  { id: 'link', glyph: '🔗', label: 'Ссылка (Ctrl+K)', primary: false },
  { id: 'quote', glyph: '"', label: 'Цитата (Ctrl+Shift+.)', primary: false },
  { id: 'emoji', glyph: '😊', label: 'Эмодзи (Ctrl+Shift+J)', primary: true },
];

export function Toolbar({
  onAction,
  onEmoji,
  narrow,
}: {
  onAction: (id: ActionId) => void;
  onEmoji: (anchor: HTMLElement) => void;
  narrow: boolean;
}) {
  const visible = narrow ? BUTTONS.filter((b) => b.primary) : BUTTONS;
  const overflow = narrow ? BUTTONS.filter((b) => !b.primary) : [];

  const dispatch = (b: ToolButton, el: HTMLElement) => {
    if (b.id === 'emoji') return onEmoji(el);
    if (b.id === 'more') return;
    onAction(b.id as ActionId);
  };

  return (
    <div className="cw-toolbar" role="toolbar" aria-label="Форматирование">
      {visible.map((b) => (
        <button
          key={b.id}
          type="button"
          className="cw-tool"
          title={b.label}
          aria-label={b.label}
          onClick={(e) => dispatch(b, e.currentTarget)}
        >
          {b.glyph}
        </button>
      ))}
      {overflow.length > 0 && (
        <>
          <button
            type="button"
            className="cw-tool"
            popoverTarget="cw-toolbar-more"
            title="Ещё"
            aria-label="Ещё инструменты"
          >
            ⋯
          </button>
          {/* Popover API (design §2.4): top-layer + light-dismiss for free. */}
          <div id="cw-toolbar-more" popover="auto" className="cw-popover">
            {overflow.map((b) => (
              <button
                key={b.id}
                type="button"
                className="cw-menu-item"
                onClick={(e) => dispatch(b, e.currentTarget)}
              >
                <span className="cw-tool cw-tool--inline">{b.glyph}</span> {b.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
