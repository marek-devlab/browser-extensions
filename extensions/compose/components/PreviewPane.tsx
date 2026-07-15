import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Callout } from '@blur/ui';
import { renderPreview } from '../utils/markdown';
import { useT } from '../utils/i18n';

// Read-only preview (design §2.2, §5.5, §7).
//
// 🔴 THE SECURITY BOUNDARY IN PRACTICE. Two properties, both structural:
//
//  1. The ONLY way HTML reaches this pane is a DocumentFragment coming out of
//     `sanitizeToFragment()`, attached with `replaceChildren` — NODES, never a
//     string. No innerHTML / dangerouslySetInnerHTML anywhere (design §7.1).
//
//  2. It renders inside a **closed Shadow DOM**. The preview is allowed to carry
//     `class` attributes; in the light DOM a hostile `class` could borrow the
//     extension's own styles and paint a convincing fake "Copy" button over the
//     real one (clickjacking, design §7.2). A closed shadow root means the
//     preview's classes cannot reach our stylesheet and our page cannot be
//     restyled from inside it. Design tokens still cross the boundary, because
//     CSS custom properties inherit — so the theme is free and nothing else is.
//
// Performance (design §5.5): render is debounced and deferred to an idle
// callback; if a single render takes longer than 50 ms, or the draft is huge,
// the pane switches to MANUAL refresh and says so out loud instead of quietly
// lagging on every keystroke.

const HUGE_CHARS = 200_000;
const SLOW_RENDER_MS = 50;
const DEBOUNCE_MS = 120;

/** Styles for the shadow tree. Built on the shared tokens, which inherit through
 *  the shadow boundary — no hard-coded #fff (design §9.3). */
const PREVIEW_CSS = `
:host { display: block; color: var(--text); font-family: var(--sans); font-size: 13px; line-height: 1.55; }
.md > * { content-visibility: auto; contain-intrinsic-size: auto 40px; }
h1, h2, h3, h4, h5, h6 { margin: 14px 0 8px; line-height: 1.3; }
h1 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
h2 { font-size: 1.25em; border-bottom: 1px solid var(--border); padding-bottom: 3px; }
h3 { font-size: 1.1em; }
p { margin: 8px 0; }
a { color: var(--accent-fg); }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code { font-family: var(--mono); background: var(--bg-elev); padding: 1px 4px; border-radius: 3px; font-size: 0.92em; }
pre { background: var(--bg-elev); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 8px 0; padding: 2px 10px; border-left: 3px solid var(--border); color: var(--text-dim); }
ul, ol { margin: 8px 0; padding-left: 22px; }
li { margin: 2px 0; }
ul.cw-task-list { list-style: none; padding-left: 4px; }
ul.cw-task-list input { margin-right: 6px; }
table { border-collapse: collapse; margin: 10px 0; display: block; overflow-x: auto; max-width: 100%; }
th, td { border: 1px solid var(--border); padding: 4px 9px; text-align: left; }
th { background: var(--bg-elev); }
details { border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; margin: 10px 0; }
summary { cursor: pointer; font-weight: 600; min-height: 24px; }
img { max-width: 100%; height: auto; }
hr { border: none; border-top: 1px solid var(--border); margin: 14px 0; }
`;

export function PreviewPane({
  body,
  warnOnSanitize,
}: {
  body: string;
  warnOnSanitize: boolean;
}) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLElement | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [showRemoved, setShowRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(body.length > HUGE_CHARS);
  const [stale, setStale] = useState(false);

  const paint = useCallback((source: string) => {
    const mount = mountRef.current;
    if (!mount) return;
    const started = performance.now();
    try {
      const { fragment, removed: stripped } = renderPreview(source, t);
      mount.replaceChildren(fragment); // ✅ the single string→DOM boundary
      setRemoved(stripped);
      setError(null);
      setStale(false);
    } catch (e) {
      // §8.5 — a parser exception must not take the editor down with it.
      setError(e instanceof Error ? e.message : String(e));
      mount.replaceChildren();
    }
    if (performance.now() - started > SLOW_RENDER_MS) setManual(true);
  }, [t]);

  /* Create the closed shadow root once. */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || mountRef.current) return;
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = PREVIEW_CSS; // textContent, never innerHTML
    const mount = document.createElement('div');
    mount.className = 'md';
    root.append(style, mount);
    mountRef.current = mount;
    paint(body);
    // `body` intentionally not a dep: the render effect below owns updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint]);

  /* Debounced + idle re-render. In manual mode nothing repaints by itself — the
   * pane says it is stale and waits for the button (design §5.5). */
  useEffect(() => {
    if (!mountRef.current) return;
    if (manual) {
      setStale(true);
      return;
    }
    let idle: number | undefined;
    const t = setTimeout(() => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback;
      if (ric) idle = ric(() => paint(body), { timeout: 400 });
      else paint(body);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      const cic = (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (idle !== undefined && cic) cic(idle);
    };
  }, [body, manual, paint]);

  return (
    <div className="cw-preview-wrap">
      {manual && (
        <div className="cw-preview-manual" role="status">
          <span>{t('preview_manual', { stale: stale ? t('preview_stale') : '' })}</span>
          <Button onClick={() => paint(body)}>{t('preview_refresh')}</Button>
        </div>
      )}

      {error && (
        <Callout tone="poor" title={t('preview_error_title')}>
          {t('preview_error_body', { error })}
        </Callout>
      )}

      {warnOnSanitize && removed.length > 0 && (
        <Callout tone="warn" title={t('preview_removed_title', { n: removed.length })}>
          <p>
            {t('preview_removed_body_1')}
            <strong>{t('preview_removed_strong')}</strong>
            {t('preview_removed_body_2')}
          </p>
          <button
            type="button"
            className="cw-linklike"
            aria-expanded={showRemoved}
            onClick={() => setShowRemoved((v) => !v)}
          >
            {showRemoved ? t('preview_hide') : t('preview_show_removed')}
          </button>
          {showRemoved && (
            // textContent only — the removed markup is rendered as ESCAPED TEXT,
            // never as HTML (design §7.3).
            <pre className="mono cw-removed">{removed.join('\n')}</pre>
          )}
        </Callout>
      )}

      <div
        ref={hostRef}
        className="cw-preview"
        role="region"
        aria-label={t('preview_region_aria')}
      />
    </div>
  );
}
