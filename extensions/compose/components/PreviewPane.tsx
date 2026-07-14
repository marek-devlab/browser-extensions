import { useEffect, useRef, useState } from 'react';
import { Callout } from '@blur/ui';
import { renderPreviewMock } from '../utils/markdown';

// Read-only preview (design §2.2, §7). The preview is the SECURITY BOUNDARY: the
// ONLY way HTML reaches this pane is a DocumentFragment from
// sanitizeToFragment(), attached with `replaceChildren` — NODES, never a string.
// 🔴 No innerHTML / dangerouslySetInnerHTML anywhere (design §7.1).
//
// Scaffold: renderPreviewMock() returns a static, safe fragment built with
// createElement + textContent (see utils/sanitize.ts). The real markdown-it →
// DOMPurify pipeline is stubbed (utils/markdown.ts). When the sanitizer reports
// stripped content, the §7.3 banner shows.

export function PreviewPane({ body }: { body: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [removed, setRemoved] = useState<string[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // NOTE: real impl renders in a closed Shadow DOM so a hostile `class` can't
    // reach extension styles (clickjacking the Copy button — design §7.2). The
    // scaffold attaches to a light-DOM node for simplicity; TODO_LOGIC: Shadow.
    const { fragment, removed } = renderPreviewMock();
    host.replaceChildren(fragment); // ✅ the single string→DOM boundary
    setRemoved(removed);
  }, [body]);

  return (
    <div className="cw-preview-wrap">
      {removed.length > 0 && (
        <Callout tone="warn" title={`В превью не показаны ${removed.length} фрагмента`}>
          Мы вырезали HTML, который может выполнить код внутри расширения:{' '}
          {removed.join(', ')}. Ваш текст НЕ изменён — вырезано только из превью.
          GitHub и GitLab вырежут это тоже.
        </Callout>
      )}
      <div
        ref={hostRef}
        className="cw-preview"
        role="region"
        aria-label="Превью — близко к GitHub, не идентично"
      />
    </div>
  );
}
