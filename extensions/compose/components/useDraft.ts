import { useCallback, useEffect, useRef, useState } from 'react';
import { activeDraftIdItem, draftsItem, withDraftsLock } from '../utils/storage';
import { MOCK_DRAFTS } from '../utils/mock';
import type { Draft, Target } from '../utils/types';

// Draft state + persistence (design §1.4, §8.3). ✅ REAL persistence to `local:`.
//
// The body is the single source of truth. Edits debounce to `local:drafts` under
// the shared Web Lock so the background context-menu writer can't clobber. The
// save STATUS is honest: it flips to "saved" only after `setValue` resolves —
// never before (the exact lie `blur` shipped with sync, PLAN.md §18a).
//
// On first run there are no stored drafts, so the mock set is seeded so every
// surface renders alive (behind a <MockBadge>). Real edits persist over them.

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function useDraft(autosaveDelay = 800) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      const [stored, id] = await Promise.all([
        draftsItem.getValue(),
        activeDraftIdItem.getValue(),
      ]);
      const list = stored.length > 0 ? stored : MOCK_DRAFTS;
      setDrafts(list);
      setActiveId(id ?? list[0]?.id ?? null);
    })();
  }, []);

  const active = drafts?.find((d) => d.id === activeId) ?? null;

  const persist = useCallback((next: Draft[]) => {
    setSaveState('saving');
    void withDraftsLock(async () => {
      await draftsItem.setValue(next);
    })
      .then(() => setSaveState('saved'))
      .catch(() => setSaveState('error')); // QuotaExceeded etc. — never fake "saved" (design §8.2)
  }, []);

  /** Debounced body edit — updates state immediately, persists after the delay. */
  const setBody = useCallback(
    (body: string) => {
      setDrafts((prev) => {
        if (!prev) return prev;
        const next = prev.map((d) =>
          d.id === activeId ? { ...d, body, updatedAt: Date.now() } : d,
        );
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => persist(next), autosaveDelay);
        return next;
      });
    },
    [activeId, autosaveDelay, persist],
  );

  const setTarget = useCallback(
    (target: Target) => {
      setDrafts((prev) => {
        if (!prev) return prev;
        const next = prev.map((d) => (d.id === activeId ? { ...d, target } : d));
        persist(next);
        return next;
      });
    },
    [activeId, persist],
  );

  const selectDraft = useCallback((id: string) => {
    setActiveId(id);
    void activeDraftIdItem.setValue(id);
  }, []);

  const newDraft = useCallback(() => {
    const draft: Draft = {
      id: `d-${Date.now()}`,
      title: 'Новый черновик',
      body: '',
      target: 'github',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setDrafts((prev) => {
      const next = [draft, ...(prev ?? [])];
      persist(next);
      return next;
    });
    selectDraft(draft.id);
  }, [persist, selectDraft]);

  return { drafts, active, activeId, saveState, setBody, setTarget, selectDraft, newDraft };
}
