import type { ActionId } from '../utils/editor-actions';
import type { Template } from '../utils/types';

// Editor toolbar (design §2.3). Each button dispatches an `ActionId` that
// EditorPane applies via utils/editor-actions (pure string insertion into the
// draft, one undo step).
//
// ⚠️ On a narrow panel the toolbar does NOT scroll horizontally — that is misery
// for touch and keyboard users. Low-priority buttons collapse into a `⋯` popover
// instead; B, ☑, <>, ⌄ and 😊 always stay visible (design §2.3).

interface ToolButton {
  id: ActionId | 'emoji';
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
  { id: 'codeBlock', glyph: '{}', label: 'Блок кода (Ctrl+Shift+E)', primary: false },
  { id: 'bullet', glyph: '•', label: 'Список (Ctrl+Shift+8)', primary: false },
  { id: 'ordered', glyph: '1.', label: 'Нумерованный список (Ctrl+Shift+7)', primary: false },
  { id: 'task', glyph: '☑', label: 'Задача — [ ] (Ctrl+Shift+C)', primary: true },
  { id: 'details', glyph: '⌄', label: '<details> (Ctrl+Shift+D)', primary: true },
  { id: 'table', glyph: '▦', label: 'Таблица (Ctrl+Shift+T)', primary: false },
  { id: 'link', glyph: '🔗', label: 'Ссылка (Ctrl+K)', primary: false },
  { id: 'quote', glyph: '❝', label: 'Цитата (Ctrl+Shift+.)', primary: false },
  { id: 'emoji', glyph: '😊', label: 'Эмодзи (Ctrl+Shift+J)', primary: true },
];

export function Toolbar({
  onAction,
  onEmoji,
  onTemplate,
  onEnvironment,
  templates,
  narrow,
}: {
  onAction: (id: ActionId) => void;
  onEmoji: () => void;
  onTemplate: (t: Template, mode: 'append' | 'replace') => void;
  onEnvironment: () => void;
  templates: Template[];
  narrow: boolean;
}) {
  const visible = narrow ? BUTTONS.filter((b) => b.primary) : BUTTONS;
  const overflow = narrow ? BUTTONS.filter((b) => !b.primary) : [];

  const dispatch = (b: ToolButton) => {
    if (b.id === 'emoji') onEmoji();
    else onAction(b.id);
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
          aria-haspopup={b.id === 'emoji' ? 'dialog' : undefined}
          onClick={() => dispatch(b)}
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
            title="Ещё инструменты"
            aria-label="Ещё инструменты"
          >
            ⋯
          </button>
          {/* Popover API (design §2.4): top-layer, light-dismiss and Esc for free. */}
          <div id="cw-toolbar-more" popover="auto" className="cw-popover">
            {overflow.map((b) => (
              <button key={b.id} type="button" className="cw-menu-item" onClick={() => dispatch(b)}>
                <span className="cw-tool cw-tool--inline" aria-hidden="true">{b.glyph}</span> {b.label}
              </button>
            ))}
          </div>
        </>
      )}

      <span className="cw-toolbar__spacer" />

      <button
        type="button"
        className="cw-tool cw-tool--text"
        popoverTarget="cw-templates"
        title="Шаблоны"
        aria-label="Шаблоны"
      >
        📋 <span className="cw-tool__text">Шаблоны</span>
      </button>
      <TemplateMenu templates={templates} onPick={onTemplate} />

      <button
        type="button"
        className="cw-tool cw-tool--text"
        onClick={onEnvironment}
        title="Вставить окружение (браузер, ОС, экран, URL)"
        aria-label="Вставить окружение"
      >
        ⧉ <span className="cw-tool__text">Окружение</span>
      </button>
    </div>
  );
}

function TemplateMenu({
  templates,
  onPick,
}: {
  templates: Template[];
  onPick: (t: Template, mode: 'append' | 'replace') => void;
}) {
  return (
    <div id="cw-templates" popover="auto" className="cw-popover">
      <p className="cw-hint">Шаблон вставляется в конец. Чтобы заменить весь черновик — «Заменить».</p>
      {templates.map((t) => (
        <div key={t.id} className="cw-menu-row">
          <button type="button" className="cw-menu-item" onClick={() => onPick(t, 'append')}>
            {t.name}
          </button>
          <button
            type="button"
            className="cw-tool cw-tool--inline"
            title={`Заменить черновик шаблоном «${t.name}»`}
            aria-label={`Заменить черновик шаблоном ${t.name}`}
            onClick={() => onPick(t, 'replace')}
          >
            ⤾
          </button>
        </div>
      ))}
    </div>
  );
}
