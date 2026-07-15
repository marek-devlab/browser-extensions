import { useCallback, useEffect, useState } from 'react';
import { Button } from '@blur/ui';
import { snapshotsFor, type UsageInfo } from '../utils/storage';
import { countText } from '../utils/counter';
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
        <h2 id="cw-hist-title">История</h2>
        <button
          type="button"
          className="cw-tool cw-tool--inline"
          aria-label="Закрыть"
          onClick={() => dialogRef.current?.close()}
        >
          ✕
        </button>
      </header>

      <div className="cw-hist">
        <section className="cw-hist__col">
          <h3>Черновики ({drafts.length})</h3>
          <ul className="cw-hist__list">
            {drafts.map((d) => (
              <li key={d.id} className={d.id === activeId ? 'cw-hist__item cw-hist__item--active' : 'cw-hist__item'}>
                <button type="button" className="cw-menu-item" onClick={() => onSelect(d.id)}>
                  {d.id === activeId ? '● ' : ''}
                  {d.title || '(без имени)'}
                  <span className="cw-hint"> · {ago(d.updatedAt)} · {countText(d.body).graphemes} симв</span>
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
                      Удалить навсегда
                    </button>
                    <button type="button" className="cw-linklike" onClick={() => setConfirmDelete(null)}>
                      Отмена
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="cw-tool cw-tool--inline"
                    title={`Удалить «${d.title}»`}
                    aria-label={`Удалить черновик ${d.title}`}
                    onClick={() => setConfirmDelete(d.id)}
                  >
                    🗑
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="cw-actions">
            <Button onClick={onNew}>＋ Новый</Button>
            {active && (
              <Button onClick={() => downloadMarkdown(active)}>Экспорт .md</Button>
            )}
          </div>
        </section>

        <section className="cw-hist__col">
          <h3>Снимки: «{active?.title ?? '—'}»</h3>
          {snapshots.length === 0 && <p className="cw-hint">Снимков пока нет.</p>}
          <ul className="cw-hist__list">
            {snapshots.map((s) => (
              <li key={s.id} className="cw-hist__item">
                <span>
                  {s.reason === 'pre-destructive' ? '⚑ ' : '○ '}
                  {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
                  {REASON[s.reason]}
                  {s.label ? ` — ${s.label}` : ''}
                  <span className="cw-hint"> · {countText(s.body).graphemes} симв</span>
                </span>
                <button
                  type="button"
                  className="cw-linklike"
                  onClick={() => {
                    onRestore(s.body);
                    dialogRef.current?.close();
                  }}
                >
                  Восстановить
                </button>
              </li>
            ))}
          </ul>
          <p className="cw-hint">
            ⚠️ Восстановление перезапишет текущий текст. Текущий сохранится снимком — откатить можно.
          </p>
        </section>
      </div>

      {usage && (
        <p className="cw-hint">
          Занято {(usage.bytes / 1024 / 1024).toFixed(2)} МБ из {(usage.quota / 1024 / 1024).toFixed(0)} МБ
          (storage.local){usage.estimated ? ', оценка' : ''}.
        </p>
      )}
    </dialog>
  );
}

const REASON: Record<Snapshot['reason'], string> = {
  autosave: 'автосейв',
  manual: 'вручную',
  'pre-destructive': 'перед изменением',
  created: 'создан',
};

function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч`;
  return `${Math.round(h / 24)} дн`;
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
