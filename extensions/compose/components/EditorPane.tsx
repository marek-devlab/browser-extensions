import { useCallback, useEffect, useRef } from 'react';
import { actions, insertText, type ActionId, type EditState } from '../utils/editor-actions';

// The editor — a flat <textarea> that IS the single source of truth (design §1.3).
//
// Three things here are not "just a textarea":
//
//  1. OWN UNDO STACK (design §9.1). The native textarea undo history is destroyed
//     the moment you set `.value` programmatically, and every toolbar button does
//     exactly that. So Ctrl+Z is ours: typing is coalesced into one undo step,
//     and a "Replace all" over 4 matches rolls back as ONE step, not four.
//
//  2. TAB DOES NOT MOVE TEXT unless the caret is inside a list. ⚠️ Swallowing Tab
//     in a textarea is a focus trap for keyboard and screen-reader users — the
//     one accessibility sin we never commit. Outside a list, Tab moves focus.
//
//  3. A MIRROR <pre> BEHIND THE TEXTAREA carries the regex match highlights via
//     the CSS Custom Highlight API. You cannot highlight inside a <textarea> (its
//     value is not a text node), and painting thousands of <span>s is the classic
//     way to make a big document crawl. The mirror holds one text node; ranges
//     are drawn on it and the textarea sits on top with a transparent background.
//     If CSS.highlights is missing, the feature degrades to a match LIST in the
//     drawer — no span fallback (design §8.5).

export interface EditorHandle {
  applyAction: (id: ActionId) => void;
  insertText: (value: string) => void;
  replaceRange: (start: number, end: number, value: string) => void;
  /** Replace the whole body as ONE undo step (Replace All, translit, template). */
  replaceAll: (body: string) => void;
  getSelection: () => { start: number; end: number };
  focus: () => void;
  scrollTo: (offset: number) => void;
  undo: () => void;
  redo: () => void;
}

interface Snapshot extends EditState {
  at: number;
}

/** Typing within this window collapses into a single undo step. */
const COALESCE_MS = 600;

export function EditorPane({
  body,
  onChange,
  onSelectionChange,
  monospace,
  softWrap,
  spellcheck,
  fontSize,
  handleRef,
  matches,
  currentMatch,
}: {
  body: string;
  onChange: (body: string) => void;
  onSelectionChange: (sel: { start: number; end: number }) => void;
  monospace: boolean;
  softWrap: boolean;
  spellcheck: boolean;
  fontSize: number;
  handleRef: React.RefObject<EditorHandle | null>;
  /** [start,end) ranges to highlight (regex matches). */
  matches: { start: number; end: number }[];
  currentMatch: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLPreElement>(null);
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const lastPush = useRef(0);

  const currentState = useCallback((): EditState => {
    const el = ref.current;
    return {
      body,
      start: el?.selectionStart ?? body.length,
      end: el?.selectionEnd ?? body.length,
    };
  }, [body]);

  const pushUndo = useCallback((state: EditState, coalesce: boolean) => {
    const now = Date.now();
    if (coalesce && now - lastPush.current < COALESCE_MS && undoStack.current.length > 0) return;
    lastPush.current = now;
    undoStack.current.push({ ...state, at: now });
    if (undoStack.current.length > 200) undoStack.current.shift();
    redoStack.current = [];
  }, []);

  const restore = useCallback(
    (state: EditState) => {
      onChange(state.body);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(state.start, state.end);
        onSelectionChange({ start: state.start, end: state.end });
      });
    },
    [onChange, onSelectionChange],
  );

  const commit = useCallback(
    (next: EditState) => {
      pushUndo(currentState(), false);
      restore(next);
    },
    [currentState, pushUndo, restore],
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push({ ...currentState(), at: Date.now() });
    lastPush.current = 0;
    restore(prev);
  }, [currentState, restore]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push({ ...currentState(), at: Date.now() });
    restore(next);
  }, [currentState, restore]);

  handleRef.current = {
    applyAction: (id) => commit(actions[id](currentState())),
    insertText: (value) => commit(insertText(currentState(), value)),
    replaceRange: (start, end, value) => {
      const s = currentState();
      commit({
        body: s.body.slice(0, start) + value + s.body.slice(end),
        start: start + value.length,
        end: start + value.length,
      });
    },
    replaceAll: (nextBody) => commit({ body: nextBody, start: 0, end: 0 }),
    getSelection: () => {
      const el = ref.current;
      return { start: el?.selectionStart ?? 0, end: el?.selectionEnd ?? 0 };
    },
    focus: () => ref.current?.focus(),
    scrollTo: (offset) => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(offset, offset);
      // Nudge the caret into view: setSelectionRange alone does not scroll in
      // every engine.
      const before = body.slice(0, offset).split('\n').length - 1;
      const lineHeight = fontSize * 1.5;
      el.scrollTop = Math.max(0, before * lineHeight - el.clientHeight / 2);
    },
    undo,
    redo,
  };

  /* ── highlights (CSS Custom Highlight API) ─────────────────────────────*/
  useEffect(() => {
    const mirror = mirrorRef.current;
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightCtor = (globalThis as unknown as {
      Highlight?: new (...ranges: Range[]) => unknown;
    }).Highlight;
    if (!mirror || !highlights || !HighlightCtor) return; // §8.5 — degrade to the list

    const node = mirror.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      highlights.delete('cw-match');
      highlights.delete('cw-current');
      return;
    }
    const len = node.nodeValue?.length ?? 0;
    const make = (list: { start: number; end: number }[]) =>
      list
        .filter((m) => m.start < len && m.end <= len && m.end > m.start)
        .map((m) => {
          const r = new Range();
          r.setStart(node, m.start);
          r.setEnd(node, m.end);
          return r;
        });

    const others = matches.filter((_, i) => i !== currentMatch);
    const current = matches[currentMatch] ? [matches[currentMatch]] : [];

    // ⚠️ ::highlight() only accepts color / background-color / text-decoration /
    // text-shadow — `font-weight` is NOT settable there, so the CURRENT match is
    // distinguished by a different background + underline (design §2.5).
    highlights.set('cw-match', new HighlightCtor(...make(others)));
    highlights.set('cw-current', new HighlightCtor(...make(current)));

    return () => {
      highlights.delete('cw-match');
      highlights.delete('cw-current');
    };
  }, [matches, currentMatch, body]);

  /* Keep the mirror scrolled with the textarea. */
  const syncScroll = () => {
    const el = ref.current;
    const mirror = mirrorRef.current;
    if (!el || !mirror) return;
    mirror.scrollTop = el.scrollTop;
    mirror.scrollLeft = el.scrollLeft;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab: list indent ONLY inside a list; otherwise it must move focus.
    if (e.key === 'Tab') {
      const s = currentState();
      const lineStart = s.body.lastIndexOf('\n', s.start - 1) + 1;
      const line = s.body.slice(lineStart, s.body.indexOf('\n', s.start) === -1 ? undefined : s.body.indexOf('\n', s.start));
      if (!/^\s*(?:[-*+]|\d+\.)\s/.test(line)) return; // let focus move — no trap
      e.preventDefault();
      if (e.shiftKey) {
        if (!/^ {1,2}/.test(line)) return;
        const cut = line.startsWith('  ') ? 2 : 1;
        commit({
          body: s.body.slice(0, lineStart) + s.body.slice(lineStart + cut),
          start: Math.max(lineStart, s.start - cut),
          end: Math.max(lineStart, s.end - cut),
        });
      } else {
        commit({
          body: s.body.slice(0, lineStart) + '  ' + s.body.slice(lineStart),
          start: s.start + 2,
          end: s.end + 2,
        });
      }
      return;
    }

    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();

    if (key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (key === 'y') {
      e.preventDefault();
      redo();
      return;
    }

    if (!e.shiftKey) {
      const map: Record<string, ActionId> = { b: 'bold', i: 'italic', e: 'code', k: 'link' };
      const id = map[key];
      if (id) {
        e.preventDefault();
        commit(actions[id](currentState()));
      }
      return;
    }

    const shiftMap: Record<string, ActionId> = {
      c: 'task',
      d: 'details',
      t: 'table',
      x: 'strike',
      e: 'codeBlock',
      '*': 'bullet',
      '8': 'bullet',
      '&': 'ordered',
      '7': 'ordered',
      '>': 'quote',
      '.': 'quote',
    };
    const sid = shiftMap[key];
    if (sid) {
      e.preventDefault();
      commit(actions[sid](currentState()));
    }
  };

  return (
    <div className="cw-editor-wrap">
      {/* The highlight mirror. aria-hidden: it is a painting surface, not content. */}
      <pre
        ref={mirrorRef}
        className="cw-editor-mirror"
        aria-hidden="true"
        style={{
          fontFamily: monospace ? 'var(--mono)' : 'var(--sans)',
          whiteSpace: softWrap ? 'pre-wrap' : 'pre',
          fontSize: `${fontSize}px`,
        }}
      >
        {body + '\n'}
      </pre>
      <textarea
        ref={ref}
        className="cw-editor"
        value={body}
        onChange={(e) => {
          pushUndo({ body, start: e.target.selectionStart, end: e.target.selectionEnd }, true);
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onScroll={syncScroll}
        onSelect={(e) => {
          const el = e.currentTarget;
          onSelectionChange({ start: el.selectionStart, end: el.selectionEnd });
        }}
        spellCheck={spellcheck}
        aria-label="Редактор Markdown"
        style={{
          fontFamily: monospace ? 'var(--mono)' : 'var(--sans)',
          whiteSpace: softWrap ? 'pre-wrap' : 'pre',
          fontSize: `${fontSize}px`,
        }}
      />
    </div>
  );
}
