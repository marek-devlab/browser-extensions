import { useRef } from 'react';
import { actions, insertText, type ActionId, type EditState } from '../utils/editor-actions';

// The editor — a flat <textarea> that IS the single source of truth (design §1.3).
// Toolbar actions are REAL: they run utils/editor-actions over the current
// selection and write back, restoring the caret. Keyboard shortcuts (design §9.1)
// are wired here so they live INSIDE the document, not in manifest.commands
// (which would give a tool its own entry point — design §1.1).

export interface EditorHandle {
  applyAction: (id: ActionId) => void;
  insertText: (value: string) => void;
}

export function EditorPane({
  body,
  onChange,
  monospace,
  softWrap,
  spellcheck,
  fontSize,
  handleRef,
}: {
  body: string;
  onChange: (body: string) => void;
  monospace: boolean;
  softWrap: boolean;
  spellcheck: boolean;
  fontSize: number;
  handleRef: React.RefObject<EditorHandle | null>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const currentState = (): EditState => {
    const el = ref.current;
    return {
      body,
      start: el?.selectionStart ?? body.length,
      end: el?.selectionEnd ?? body.length,
    };
  };

  const commit = (next: EditState) => {
    onChange(next.body);
    // Restore selection after React re-renders the value.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.start, next.end);
      }
    });
  };

  handleRef.current = {
    applyAction: (id) => commit(actions[id](currentState())),
    insertText: (value) => commit(insertText(currentState(), value)),
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const map: Record<string, ActionId> = {
      b: 'bold',
      i: 'italic',
      e: 'code',
      k: 'link',
    };
    const id = map[e.key.toLowerCase()];
    if (id && !e.shiftKey) {
      e.preventDefault();
      commit(actions[id](currentState()));
      return;
    }
    if (e.shiftKey) {
      const shiftMap: Record<string, ActionId> = { c: 'task', d: 'details', t: 'table' };
      const sid = shiftMap[e.key.toLowerCase()];
      if (sid) {
        e.preventDefault();
        commit(actions[sid](currentState()));
      }
    }
    // NOTE: Tab is intentionally NOT trapped here — hijacking Tab in a <textarea>
    // is a focus trap for keyboard/screen-reader users (design §9.1). List indent
    // on Tab is only wired when the caret is inside a list (TODO_LOGIC).
  };

  return (
    <textarea
      ref={ref}
      className="cw-editor mono"
      value={body}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      spellCheck={spellcheck}
      aria-label="Редактор Markdown"
      style={{
        fontFamily: monospace ? 'var(--mono)' : 'var(--sans)',
        whiteSpace: softWrap ? 'pre-wrap' : 'pre',
        fontSize: `${fontSize}px`,
      }}
    />
  );
}
