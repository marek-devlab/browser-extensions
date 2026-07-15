import { useT, type MsgKey } from '../utils/i18n';
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
  /** i18n key for the tooltip/aria label. */
  label: MsgKey;
  /** Kept in the always-visible set on a ~320px panel. */
  primary: boolean;
}

const BUTTONS: ToolButton[] = [
  { id: 'bold', glyph: 'B', label: 'tb_bold', primary: true },
  { id: 'italic', glyph: 'I', label: 'tb_italic', primary: false },
  { id: 'strike', glyph: 'S̶', label: 'tb_strike', primary: false },
  { id: 'code', glyph: '<>', label: 'tb_code', primary: true },
  { id: 'codeBlock', glyph: '{}', label: 'tb_codeBlock', primary: false },
  { id: 'bullet', glyph: '•', label: 'tb_bullet', primary: false },
  { id: 'ordered', glyph: '1.', label: 'tb_ordered', primary: false },
  { id: 'task', glyph: '☑', label: 'tb_task', primary: true },
  { id: 'details', glyph: '⌄', label: 'tb_details', primary: true },
  { id: 'table', glyph: '▦', label: 'tb_table', primary: false },
  { id: 'link', glyph: '🔗', label: 'tb_link', primary: false },
  { id: 'quote', glyph: '❝', label: 'tb_quote', primary: false },
  { id: 'emoji', glyph: '😊', label: 'tb_emoji', primary: true },
];

/** Built-in template id → its translated menu name (user templates keep .name). */
const TEMPLATE_NAME_KEY: Record<string, MsgKey> = {
  bug: 'tpl_bug',
  'bug-short': 'tpl_bug_short',
  feature: 'tpl_feature',
  mr: 'tpl_mr',
  postmortem: 'tpl_postmortem',
};

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
  const t = useT();
  const visible = narrow ? BUTTONS.filter((b) => b.primary) : BUTTONS;
  const overflow = narrow ? BUTTONS.filter((b) => !b.primary) : [];

  const dispatch = (b: ToolButton) => {
    if (b.id === 'emoji') onEmoji();
    else onAction(b.id);
  };

  return (
    <div className="cw-toolbar" role="toolbar" aria-label={t('toolbar_aria')}>
      {visible.map((b) => (
        <button
          key={b.id}
          type="button"
          className="cw-tool"
          title={t(b.label)}
          aria-label={t(b.label)}
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
            title={t('toolbar_more')}
            aria-label={t('toolbar_more')}
          >
            ⋯
          </button>
          {/* Popover API (design §2.4): top-layer, light-dismiss and Esc for free. */}
          <div id="cw-toolbar-more" popover="auto" className="cw-popover">
            {overflow.map((b) => (
              <button key={b.id} type="button" className="cw-menu-item" onClick={() => dispatch(b)}>
                <span className="cw-tool cw-tool--inline" aria-hidden="true">{b.glyph}</span> {t(b.label)}
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
        title={t('templates')}
        aria-label={t('templates')}
      >
        📋 <span className="cw-tool__text">{t('templates')}</span>
      </button>
      <TemplateMenu templates={templates} onPick={onTemplate} />

      <button
        type="button"
        className="cw-tool cw-tool--text"
        onClick={onEnvironment}
        title={t('environment_insert_title')}
        aria-label={t('environment_insert_aria')}
      >
        ⧉ <span className="cw-tool__text">{t('environment')}</span>
      </button>
    </div>
  );
}

/** The name shown in menus — translated for built-ins, verbatim for user ones. */
export function templateLabel(t: ReturnType<typeof useT>, tpl: Template): string {
  const key = tpl.builtin ? TEMPLATE_NAME_KEY[tpl.id] : undefined;
  return key ? t(key) : tpl.name;
}

function TemplateMenu({
  templates,
  onPick,
}: {
  templates: Template[];
  onPick: (t: Template, mode: 'append' | 'replace') => void;
}) {
  const t = useT();
  return (
    <div id="cw-templates" popover="auto" className="cw-popover">
      <p className="cw-hint">{t('templates_hint')}</p>
      {templates.map((tpl) => {
        const name = templateLabel(t, tpl);
        return (
          <div key={tpl.id} className="cw-menu-row">
            <button type="button" className="cw-menu-item" onClick={() => onPick(tpl, 'append')}>
              {name}
            </button>
            <button
              type="button"
              className="cw-tool cw-tool--inline"
              title={t('template_replace_with', { name })}
              aria-label={t('template_replace_with', { name })}
              onClick={() => onPick(tpl, 'replace')}
            >
              ⤾
            </button>
          </div>
        );
      })}
    </div>
  );
}
