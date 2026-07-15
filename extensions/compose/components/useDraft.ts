import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activeDraftIdItem,
  draftsItem,
  isQuotaError,
  pushSnapshot,
  storageUsage,
  unsavedBufferItem,
  withDraftsLock,
  type UsageInfo,
} from '../utils/storage';
import type { Draft, Target } from '../utils/types';

// Draft state + persistence (design §1.4, §8.2, §8.3).
//
// The body is the SINGLE SOURCE OF TRUTH and it is plain Markdown, always. No
// converter ever writes back into it (design §4.5).
//
// 🔴 NEVER LOSE A DRAFT. Three layers:
//   1. debounced write to `local:drafts` under the shared Web Lock, so the
//      background context-menu writer and the panel cannot clobber each other;
//   2. an eager `session:unsaved` mirror flushed on `visibilitychange` /
//      `pagehide` — closing a sidebar DESTROYS the document, there is no
//      "before unload" grace, so a 800 ms debounce would eat the last edit;
//   3. an honest save status: it says "saved" only after `setValue` RESOLVES.
//      QuotaExceeded surfaces as "not saved" with the text still in the editor
//      (the exact lie `blur` shipped with sync — PLAN.md §18a).

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** An autosave snapshot is worth taking at most this often (design §2.10). */
const SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000;

export interface Recovery {
  body: string;
  at: number;
  /** The body that will be overwritten if the user accepts (so we can undo). */
  current: string;
}

export function useDraft(autosaveDelay: number, autosave: boolean, historyLimit: number) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Draft[] | null>(null);
  const lastSnapshotAt = useRef<Map<string, number>>(new Map());
  const liveBody = useRef<{ id: string; body: string } | null>(null);
  /** The body of the active draft as it was last READ FROM / WRITTEN TO storage.
   *  It is the base of the append-merge below. */
  const base = useRef<{ id: string; body: string } | null>(null);
  /** Ids the user deleted, so the merge cannot resurrect them. */
  const deleted = useRef<Set<string>>(new Set());

  /* ── load ──────────────────────────────────────────────────────────────*/
  useEffect(() => {
    void (async () => {
      try {
        const [stored, id, unsaved] = await Promise.all([
          draftsItem.getValue(),
          activeDraftIdItem.getValue(),
          unsavedBufferItem.getValue(),
        ]);
        const list = stored.length > 0 ? stored : [emptyDraft()];
        const activeIdNow = id && list.some((d) => d.id === id) ? id : (list[0]?.id ?? null);
        setDrafts(list);
        setActiveId(activeIdNow);
        const activeDraft = list.find((d) => d.id === activeIdNow);
        if (activeDraft) base.current = { id: activeDraft.id, body: activeDraft.body };
        void storageUsage().then(setUsage).catch(() => {});

        // §8.3 — a newer session buffer means the last edits never reached
        // `local:` (the panel document was destroyed mid-debounce). OFFER it; do
        // not auto-apply. "We already decided for you" is how people lose the
        // version they wanted.
        const target = list.find((d) => d.id === unsaved?.draftId);
        if (unsaved && target && unsaved.at > target.updatedAt && unsaved.body !== target.body) {
          setActiveId(target.id);
          setRecovery({ body: unsaved.body, at: unsaved.at, current: target.body });
        }
      } catch (e) {
        // Storage unreadable — start on an empty draft rather than a dead
        // spinner, and say the save failed rather than pretending it worked.
        setDrafts([emptyDraft()]);
        setSaveState('error');
        setSaveError(`Не удалось прочитать черновики: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, []);

  const active = drafts?.find((d) => d.id === activeId) ?? null;

  /* ── persist ───────────────────────────────────────────────────────────*/
  /**
   * ⚠️ THE CLOBBER RACE. The background appends to the active draft when the
   * user picks "Add selection to draft" from the context menu — and it may do so
   * WHILE the panel has an un-flushed edit in its debounce window. A plain
   * `setValue(ourList)` would then overwrite the appended selection with our
   * (older) copy of that draft's body: the Web Lock serializes the two writes,
   * but it cannot make a stale payload fresh.
   *
   * So the write is a read-modify-write INSIDE the lock, with an append-merge:
   * anything storage grew past our base (the only mutation the background makes
   * is an append) is carried over onto our text. Drafts created externally are
   * kept too.
   */
  const persist = useCallback(
    (next: Draft[], activeIdAtWrite: string | null) => {
      pending.current = null;
      setSaveState('saving');
      void withDraftsLock(async () => {
        const stored = await draftsItem.getValue();
        const merged = next.map((d) => {
          if (d.id !== activeIdAtWrite) return d;
          const s = stored.find((x) => x.id === d.id);
          const b = base.current;
          if (!s || !b || b.id !== d.id || s.body === b.body) return d;
          // Storage moved under us. If it is a pure append onto our base, keep it.
          if (s.body.startsWith(b.body)) {
            return { ...d, body: d.body + s.body.slice(b.body.length), updatedAt: Date.now() };
          }
          return d; // not an append we can reason about — our text wins, nothing is lost from the editor
        });
        const known = new Set(merged.map((d) => d.id));
        const externallyCreated = stored.filter((d) => !known.has(d.id) && !deleted.current.has(d.id));
        const result = [...merged, ...externallyCreated];
        await draftsItem.setValue(result);
        const activeDraft = result.find((d) => d.id === activeIdAtWrite);
        if (activeDraft) base.current = { id: activeDraft.id, body: activeDraft.body };
        return result;
      })
        .then(async (result) => {
          setDrafts((prev) => (prev && pending.current === null ? result : prev));
          setSaveState('saved');
          setSavedAt(Date.now());
          setSaveError(null);
          await unsavedBufferItem.setValue(null).catch(() => {});
          void storageUsage().then(setUsage).catch(() => {});
        })
        .catch((e: unknown) => {
          // 🔴 Never fake "saved". The text is still in the <textarea> and in
          // session:unsaved; the banner offers a way out (design §8.2).
          setSaveState('error');
          setSaveError(
            isQuotaError(e)
              ? 'Хранилище переполнено (QuotaExceeded). Текст в редакторе цел — освободите место или экспортируйте черновик.'
              : `Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
    },
    [],
  );

  const maybeSnapshot = useCallback(
    (draft: Draft) => {
      const last = lastSnapshotAt.current.get(draft.id) ?? 0;
      if (Date.now() - last < SNAPSHOT_INTERVAL_MS) return;
      lastSnapshotAt.current.set(draft.id, Date.now());
      void pushSnapshot(
        { draftId: draft.id, body: draft.body, createdAt: Date.now(), reason: 'autosave' },
        historyLimit,
      ).catch(() => {
        /* history is best-effort; never block the draft write */
      });
    },
    [historyLimit],
  );

  /** Debounced body edit — state updates immediately, storage after the delay. */
  const setBody = useCallback(
    (body: string) => {
      setDrafts((prev) => {
        if (!prev || !activeId) return prev;
        const next = prev.map((d) =>
          d.id === activeId ? { ...d, body, updatedAt: Date.now() } : d,
        );
        pending.current = next;
        liveBody.current = { id: activeId, body };
        if (timer.current) clearTimeout(timer.current);
        if (autosave) {
          setSaveState('saving');
          timer.current = setTimeout(() => {
            const target = next.find((d) => d.id === activeId);
            if (target) maybeSnapshot(target);
            persist(next, activeId);
          }, autosaveDelay);
        }
        return next;
      });
    },
    [activeId, autosave, autosaveDelay, maybeSnapshot, persist],
  );

  /** Flush whatever is pending right now (draft switch, panel closing, autosave
   *  turned off). With autosave OFF nothing else ever writes, so this is the
   *  only thing standing between the user and a lost draft. */
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) persist(pending.current, activeId);
  }, [activeId, persist]);

  /* ── §8.3: mirror to session: when the document is about to die ────────*/
  useEffect(() => {
    const mirror = () => {
      const live = liveBody.current;
      if (!live) return;
      // Fire-and-forget: a closing sidebar gives us no time to await. session:
      // is the only store that reliably takes this write.
      void unsavedBufferItem
        .setValue({ draftId: live.id, body: live.body, at: Date.now() })
        .catch(() => {});
    };
    const leave = () => {
      mirror();
      // Also try the real write. It may not finish before the document dies —
      // that is exactly why the session mirror above goes first.
      flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leave();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', leave);
    };
  }, [flush]);

  /* ── external writes (background context menu) ─────────────────────────*/
  useEffect(() => {
    const unwatch = draftsItem.watch((next) => {
      setDrafts((prev) => {
        if (!prev) return next;
        // Do not stomp on an edit the user is typing right now — the merge in
        // `persist` carries the external append over instead.
        if (pending.current) return prev;
        const activeDraft = next.find((d) => d.id === base.current?.id);
        if (activeDraft) base.current = { id: activeDraft.id, body: activeDraft.body };
        return next;
      });
    });
    const unwatchActive = activeDraftIdItem.watch((id) => {
      if (id) setActiveId(id);
    });
    return () => {
      unwatch();
      unwatchActive();
    };
  }, []);

  /* ── mutations ─────────────────────────────────────────────────────────*/

  const patchActive = useCallback(
    (patch: Partial<Draft>) => {
      setDrafts((prev) => {
        if (!prev || !activeId) return prev;
        const next = prev.map((d) =>
          d.id === activeId ? { ...d, ...patch, updatedAt: Date.now() } : d,
        );
        persist(next, activeId);
        return next;
      });
    },
    [activeId, persist],
  );

  const setTarget = useCallback((target: Target) => patchActive({ target }), [patchActive]);
  const setTitle = useCallback((title: string) => patchActive({ title }), [patchActive]);

  const selectDraft = useCallback(
    (id: string) => {
      flush();
      setActiveId(id);
      const target = drafts?.find((d) => d.id === id);
      base.current = target ? { id: target.id, body: target.body } : null;
      void activeDraftIdItem.setValue(id).catch(() => {});
    },
    [drafts, flush],
  );

  const newDraft = useCallback(
    (seed?: Partial<Draft>) => {
      const draft = { ...emptyDraft(), ...seed };
      setDrafts((prev) => {
        const next = [draft, ...(prev ?? [])];
        persist(next, draft.id);
        return next;
      });
      base.current = { id: draft.id, body: draft.body };
      setActiveId(draft.id);
      void activeDraftIdItem.setValue(draft.id);
      void pushSnapshot(
        { draftId: draft.id, body: draft.body, createdAt: Date.now(), reason: 'created' },
        historyLimit,
      ).catch(() => {});
      return draft;
    },
    [historyLimit, persist],
  );

  const deleteDraft = useCallback(
    (id: string) => {
      deleted.current.add(id);
      setDrafts((prev) => {
        if (!prev) return prev;
        const next = prev.filter((d) => d.id !== id);
        const list = next.length > 0 ? next : [emptyDraft()];
        const nextActive = id === activeId ? (list[0]?.id ?? null) : activeId;
        persist(list, nextActive);
        if (id === activeId) {
          setActiveId(nextActive);
          const target = list.find((d) => d.id === nextActive);
          base.current = target ? { id: target.id, body: target.body } : null;
          if (nextActive) void activeDraftIdItem.setValue(nextActive);
        }
        return list;
      });
    },
    [activeId, persist],
  );

  /**
   * A DESTRUCTIVE write (template replace, Replace All, snapshot restore,
   * transliterate-the-whole-draft). Takes a ⚑ snapshot FIRST, so the previous
   * text is always one click away, then writes immediately (no debounce).
   */
  const applyDestructive = useCallback(
    async (body: string, label: string) => {
      const current = drafts?.find((d) => d.id === activeId);
      if (!current) return;
      await pushSnapshot(
        {
          draftId: current.id,
          body: current.body,
          createdAt: Date.now(),
          reason: 'pre-destructive',
          label,
        },
        historyLimit,
      ).catch(() => {});
      if (timer.current) clearTimeout(timer.current);
      setDrafts((prev) => {
        if (!prev) return prev;
        const next = prev.map((d) =>
          d.id === current.id ? { ...d, body, updatedAt: Date.now() } : d,
        );
        liveBody.current = { id: current.id, body };
        persist(next, current.id);
        return next;
      });
    },
    [activeId, drafts, historyLimit, persist],
  );

  const acceptRecovery = useCallback(() => {
    if (!recovery) return;
    void applyDestructive(recovery.body, 'до восстановления несохранённого');
    setRecovery(null);
  }, [applyDestructive, recovery]);

  const dismissRecovery = useCallback(() => {
    setRecovery(null);
    void unsavedBufferItem.setValue(null).catch(() => {});
  }, []);

  return {
    drafts,
    active,
    activeId,
    saveState,
    saveError,
    savedAt,
    usage,
    recovery,
    setBody,
    setTarget,
    setTitle,
    selectDraft,
    newDraft,
    deleteDraft,
    applyDestructive,
    acceptRecovery,
    dismissRecovery,
    flush,
    refreshUsage: () => void storageUsage().then(setUsage),
  };
}

function emptyDraft(): Draft {
  const now = Date.now();
  return {
    id: `d-${now}-${Math.random().toString(36).slice(2, 7)}`,
    title: 'Новый черновик',
    body: '',
    target: 'github',
    createdAt: now,
    updatedAt: now,
  };
}
