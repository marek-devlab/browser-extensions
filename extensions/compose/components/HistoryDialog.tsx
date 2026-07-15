import { useCallback, useEffect, useState } from 'react';
import { Button } from '@blur/ui';
import { snapshotsFor, type UsageInfo } from '../utils/storage';
import { countText } from '../utils/counter';
import { useT, type MsgKey } from '../utils/i18n';
import type { Draft, Snapshot } from '../utils/types';

// Drafts + snapshots (design §2.10). This is the safety net that makes every
// destructive operation reversible: ⚑ snapshots are taken BEFORE "Replace all",
// a template replace, a whole-draft transliteration and a snapshot restore, and
// they are never evicted from the ring buffer before ordinary autosaves.
//
// ⚠️ Restoring a snapshot is itself destructive — so it takes a snapshot of the
// CURRENT text first. There is no state you can reach here that you cannot get
// back out of.
//
// Export is `<a download>` on a Blob — no `downloads` permission (design §11).

type T = (key: MsgKey, vars?: Record<string, string | number>) => string;

const REASON_KEY: Record<Snapshot['reason'], MsgKey> = {
  autosave: 'reason_autosave',
  manual: 'reason_manual',
  'pre-destructive': 'reason_predestructive',
  created: 'reason_created',
};

export function HistoryDialog({
  dialogRef,
  drafts,
  activeId,
  usage,
  onSelect,
  onDelete,
  onNew,
  onRestore,
  onRefreshUsage,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  drafts: Draft[];
  activeId: string | null;
  usage: UsageInfo | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onRestore: (body: string) => void;
  onRefreshUsage: () => void;
}) {
  const t = useT();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!activeId) return;
    void snapshotsFor(activeId)
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
    onRefreshUsage();
  }, [activeId, onRefreshUsage]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const onOpen = () => load();
    // `dialog` has no "opened" event; the toggle event fires for <dialog> too.
    el.addEventListener('toggle', onOpen);
    return () => el.removeEventListener('toggle', onOpen);
  }, [dialogRef, load]);

  useEffect(load, [load]);

  const active = drafts.find((d) => d.id === activeId) ?? null;

  return (
    <dialog ref={dialogRef} className="cw-dialog cw-dialog--wide" aria-labelledby="cw-hist-title">
      <header className="cw-dialog__head">
        <h2 id="cw-hist-title">{t('history_title')}</h2>
        <button
          type="button"
          className="cw-tool cw-tool--inline"
          aria-label={t('close')}
          onClick={() => dialogRef.current?.close()}
        >
          ✕
        </button>
      </header>

      <div className="cw-hist">
        <section className="cw-hist__col">
          <h3>{t('history_drafts', { n: drafts.length })}</h3>
          <ul className="cw-hist__list">
            {drafts.map((d) => (
              <li key={d.id} className={d.id === activeId ? 'cw-hist__item cw-hist__item--active' : 'cw-hist__item'}>
                <button type="button" className="cw-menu-item" onClick={() => onSelect(d.id)}>
                  {d.id === activeId ? '● ' : ''}
                  {d.title || t('draft_untitled')}
                  <span className="cw-hint"> · {ago(d.updatedAt, t)} · {t('history_chars', { n: countText(d.body).graphemes })}</span>
                </button>
                {confirmDelete === d.id ? (
                  <span className="cw-hist__confirm">
                    <button
                      type="button"
                      className="cw-linklike"
                      onClick={() => {
                        onDelete(d.id);
                        setConfirmDelete(null);
                      }}
                    >
                      {t('delete_forever')}
                    </button>
                    <button type="button" className="cw-linklike" onClick={() => setConfirmDelete(null)}>
                      {t('cancel')}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="cw-tool cw-tool--inline"
                    title={t('delete_draft_title', { title: d.title })}
                    aria-label={t('delete_draft_aria', { title: d.title })}
                    onClick={() => setConfirmDelete(d.id)}
                  >
                    🗑
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="cw-actions">
            <Button onClick={onNew}>{t('btn_new')}</Button>
            {active && (
              <Button onClick={() => downloadMarkdown(active)}>{t('btn_export_md')}</Button>
            )}
          </div>
        </section>

        <section className="cw-hist__col">
          <h3>{t('history_snapshots', { title: active?.title ?? '—' })}</h3>
          {snapshots.length === 0 && <p className="cw-hint">{t('history_no_snapshots')}</p>}
          <ul className="cw-hist__list">
            {snapshots.map((s) => (
              <li key={s.id} className="cw-hist__item">
                <span>
                  {s.reason === 'pre-destructive' ? '⚑ ' : '○ '}
                  {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
                  {t(REASON_KEY[s.reason])}
                  {s.label ? ` — ${s.label}` : ''}
                  <span className="cw-hint"> · {t('history_chars', { n: countText(s.body).graphemes })}</span>
                </span>
                <button
                  type="button"
                  className="cw-linklike"
                  onClick={() => {
                    onRestore(s.body);
                    dialogRef.current?.close();
                  }}
                >
                  {t('btn_restore')}
                </button>
              </li>
            ))}
          </ul>
          <p className="cw-hint">{t('history_restore_warn')}</p>
        </section>
      </div>

      {usage && (
        <p className="cw-hint">
          {t('history_usage', {
            used: (usage.bytes / 1024 / 1024).toFixed(2),
            quota: (usage.quota / 1024 / 1024).toFixed(0),
            estimated: usage.estimated ? t('history_usage_estimate') : '',
          })}
        </p>
      )}
    </dialog>
  );
}

function ago(at: number, t: T): string {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return t('ago_now');
  if (min < 60) return t('ago_min', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('ago_hour', { n: h });
  return t('ago_day', { n: Math.round(h / 24) });
}

/** Export without the `downloads` permission: a Blob URL on an <a download>. */
function downloadMarkdown(draft: Draft): void {
  const blob = new Blob([draft.body], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(draft.title || 'draft').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60)}.md`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
