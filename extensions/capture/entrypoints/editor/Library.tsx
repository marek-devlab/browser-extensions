import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Callout, EmptyState, Spinner, useLocale } from '@blur/ui';
import {
  deleteClip,
  findInterruptedSessions,
  listClips,
  manifestToClip,
  putBlob,
  putClip,
  putManifest,
  storageEstimate,
  type SessionManifest,
} from '../../utils/db';
import { formatBytes, formatDuration } from '../../utils/format';
import { useT } from '../../utils/i18n';
import type { Clip } from '../../utils/types';

// LIBRARY (design capture.md §2.13). Real clips from IndexedDB, the crash-recovery
// card (§5.11, §10.5), and the "open your own file" entry — which lives HERE, in
// the Studio, with no icon, no context-menu item and no headline of its own
// (design §4.3). 🔴 There is no "paste a video URL" field and never will be: that
// one input turns the product into a downloader, i.e. a Prohibited Product
// (design §4.3, PLAN.md (Часть II) §4.5).

const ACCEPT =
  'video/mp4,video/webm,video/quicktime,video/x-matroska,image/png,image/jpeg,image/webp';

export function Library({ onOpen }: { onOpen: (clip: Clip) => void }) {
  const t = useT();
  const locale = useLocale();
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [interrupted, setInterrupted] = useState<SessionManifest[]>([]);
  const [used, setUsed] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [cs, ints, est] = await Promise.all([
      listClips(),
      findInterruptedSessions(),
      storageEstimate(),
    ]);
    setClips(cs);
    // An open manifest with no live owner IS an interrupted recording. The bytes
    // are on disk; only the last ≤3 s flush window can be missing (§10.5).
    setInterrupted(ints);
    setUsed(est.used);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function recover(m: SessionManifest) {
    setBusy(m.id);
    try {
      // The chunks are intact — what is NOT trustworthy is the container header of
      // a recording that was never finalised. So the clip is marked `needsRemux`
      // and the export path always re-muxes it, rather than handing over a raw
      // concatenation with a bogus duration (design §10.5).
      await putManifest({ ...m, status: 'done' });
      await putClip(manifestToClip(m, { needsRemux: true }));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function discard(m: SessionManifest) {
    setBusy(m.id);
    const { deleteSession } = await import('../../utils/db');
    await deleteSession(m.id);
    await reload();
    setBusy(null);
  }

  async function importFile(file: File) {
    setBusy('import');
    setError(null);
    try {
      const id = `imp-${Date.now()}`;
      const key = `blob-${id}`;
      const isImage = file.type.startsWith('image/');
      const meta = isImage ? await imageMeta(file) : await videoMeta(file);
      await putBlob(key, file);
      const clip: Clip = {
        id,
        kind: isImage ? 'screenshot' : 'video',
        title: file.name,
        host: '',
        createdAt: Date.now(),
        durationMs: meta.durationMs,
        resolution: { width: meta.width, height: meta.height },
        format: isImage ? 'png' : file.type.includes('webm') ? 'webm' : 'mp4',
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        blobKey: key,
        imported: true,
      };
      await putClip(clip);
      await reload();
      onOpen(clip);
    } catch {
      // ⚠️ We claim only what we actually read (MP4/MOV/WebM/MKV + PNG/JPEG/WebP).
      // An unknown or DRM-protected file gets an honest refusal, not an eternal
      // spinner (design §4.3).
      setError(t('lib_import_fail'));
    } finally {
      setBusy(null);
    }
  }

  if (!clips) return <Spinner label={t('lib_reading')} />;

  return (
    <div
      className="library"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) void importFile(f);
      }}
    >
      <header className="lib-head">
        <h2>{t('tab_library')}</h2>
        <span className="muted">
          {used != null ? t('lib_used', { size: formatBytes(used, locale) }) : ''}
        </span>
      </header>

      {error && (
        <Callout tone="warn" title={t('lib_fail_title')}>
          {error}
        </Callout>
      )}

      {interrupted.map((m) => (
        <Callout key={m.id} tone="warn" title={t('lib_interrupted_title')}>
          {new Date(m.startedAt).toLocaleString(locale)} · {m.host || t('screen_word')} ·{' '}
          {formatDuration(m.durationMs)} · {formatBytes(m.bytes, locale)}
          <br />
          {t('lib_interrupted_body')}
          <div className="lib-actions">
            <Button variant="primary" onClick={() => void recover(m)} disabled={busy === m.id}>
              {busy === m.id ? t('lib_recovering') : t('lib_recover')}
            </Button>
            <Button variant="ghost" onClick={() => void discard(m)} disabled={busy === m.id}>
              {t('delete')}
            </Button>
          </div>
        </Callout>
      ))}

      {clips.length === 0 ? (
        <EmptyState title={t('lib_empty_title')} hint={t('lib_empty_hint')} />
      ) : (
        <ul className="clip-list">
          {clips.map((clip) => (
            <li key={clip.id} className="clip">
              <div className="clip-thumb" aria-hidden="true">
                {clip.kind === 'screenshot' ? '🖼' : '🎬'}
              </div>
              <div className="clip-body">
                <p className="clip-title">{clip.title}</p>
                <p className="clip-meta muted mono">
                  {new Date(clip.createdAt).toLocaleString(locale)}
                  {clip.durationMs > 0 && ` · ${formatDuration(clip.durationMs)}`} ·{' '}
                  {clip.resolution.width}×{clip.resolution.height} ·{' '}
                  {String(clip.format).toUpperCase()} · {formatBytes(clip.sizeBytes, locale)}
                  {clip.imported && t('lib_own_file')}
                </p>
                {clip.needsRemux && <p className="warn-text">{t('lib_recovered_note')}</p>}
                <div className="clip-actions">
                  <Button variant="ghost" onClick={() => onOpen(clip)}>
                    {t('open')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void deleteClip(clip.id).then(reload);
                    }}
                  >
                    {t('delete')}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* "Convert your own file" — the same pipeline, and zero extra permissions:
          a file input needs none. Inside the Studio only (design §4.3). */}
      <div className="dropzone">
        <p>{t('lib_dropzone')}</p>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
          }}
        />
        <Button onClick={() => fileRef.current?.click()} disabled={busy === 'import'}>
          {busy === 'import' ? t('lib_reading_short') : t('lib_open_file')}
        </Button>
        <p className="muted">{t('lib_understand')}</p>
        <p className="muted">{t('lib_local_note')}</p>
      </div>
    </div>
  );
}

async function imageMeta(
  file: Blob,
): Promise<{ width: number; height: number; durationMs: number }> {
  const bmp = await createImageBitmap(file);
  const meta = { width: bmp.width, height: bmp.height, durationMs: 0 };
  bmp.close();
  return meta;
}

/** Metadata from a throwaway <video>. The object URL is revoked on every branch —
 *  a leaked one pins the entire file for the life of the page. */
function videoMeta(file: Blob): Promise<{ width: number; height: number; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      const meta = {
        width: v.videoWidth,
        height: v.videoHeight,
        durationMs: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0,
      };
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable'));
    };
    v.src = url;
  });
}
