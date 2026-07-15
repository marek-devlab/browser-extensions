import { useEffect, useRef, useState } from 'react';
import { Button, Callout, Spinner } from '@blur/ui';
import { clipBlob } from '../../utils/db';
import { newRegionId, patchEdit, useEdit } from '../../utils/edit-store';
import { formatDuration } from '../../utils/format';
import { useT, type MsgKey } from '../../utils/i18n';
import { usePrefs } from '../../utils/use-prefs';
import type { Clip, RedactionMode, RedactionRegion } from '../../utils/types';

const LABEL_KEY: Record<RedactionMode, MsgKey> = {
  fill: 'label_fill',
  blur: 'label_blur',
  pixelate: 'label_pixelate',
};

// CLIP EDITOR (design capture.md §2.6). Real video, real trim, real redaction
// rectangles over the real frame.
//
// 🔴 REDACTION IS THE SECURITY SURFACE OF THIS PRODUCT (design §7).
//   • SOLID FILL is the ONLY protection mode and stands alone under «Скрыть
//     данные». It deletes the pixels — nothing about it is written into the file.
//   • BLUR and PIXELATE live in a PHYSICALLY SEPARATE group titled «Косметика —
//     НЕ защита», with a warning that cannot be collapsed away: both are
//     REVERSIBLE. Unredacter (Bishop Fox, 2022) and Depix recover text — including
//     passwords and API keys — from blurred and pixelated images. Their authors
//     did it publicly.
//   • The two look different on screen too: a fill draws opaque, a cosmetic
//     region draws as a dashed amber box labelled «косметика». The difference has
//     to be visible to the eye, not only readable in a paragraph (§7.3).
//
// ⚠️ The rectangle does NOT track content. If what is under it scrolls, the secret
// slides out from beneath it. We say so, and default the interval to the WHOLE
// clip — covering too much is safe, covering too little is not (§7.5).

export function ClipEditor({ clip, onExport }: { clip: Clip; onExport: () => void }) {
  const t = useT();
  const edit = useEdit(clip.id, clip.durationMs);
  const { prefs } = usePrefs();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<RedactionMode>('fill');
  const [drawing, setDrawing] = useState<RedactionRegion | null>(null);
  const [duration, setDuration] = useState(clip.durationMs);
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // The media comes back as a Blob assembled from IDB chunk REFERENCES — the
  // bytes are not read into memory (utils/db.ts). The object URL is revoked on
  // unmount; leaking it would pin the whole recording.
  useEffect(() => {
    let u: string | null = null;
    let alive = true;
    void clipBlob(clip)
      .then((b) => {
        if (!alive) return;
        u = URL.createObjectURL(b);
        setUrl(u);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [clip]);

  // A recovered recording has a broken duration in its header (§10.5) — read the
  // real one off the decoded media instead of trusting the manifest.
  function onMeta() {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    const ms = Math.round(v.duration * 1000);
    setDuration(ms);
    if (edit.trimOutMs === 0 || edit.trimOutMs > ms) patchEdit({ trimOutMs: ms });
  }

  const fills = edit.regions.filter((r) => r.mode === 'fill');
  const cosmetic = edit.regions.filter((r) => r.mode !== 'fill');
  const trimmed = Math.max(0, edit.trimOutMs - edit.trimInMs);

  // Drawing a rectangle: coordinates are stored as FRACTIONS of the frame, never
  // pixels. That is what makes them survive every resolution change and every DPR
  // — the "coords were CSS px, the bitmap was device px" bug (PLAN.md §6.2)
  // cannot happen if there are no pixel coordinates to get wrong.
  function pointIn(e: React.PointerEvent): { x: number; y: number } | null {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  }

  return (
    <div className="editor-grid">
      <div className="editor-main">
        {err && (
          <Callout tone="warn" title={t('ed_open_fail')}>
            {err}
          </Callout>
        )}
        {/* Preview on a NEUTRAL CHECKERBOARD, never on --bg: in a dark theme a
            black redaction fill would blend into the page and the user would not
            see what they covered (design §11.3). */}
        <div className="preview">
          <div
            className="preview-frame"
            ref={frameRef}
            onPointerDown={(e) => {
              const p = pointIn(e);
              if (!p) return;
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setDrawing({
                id: newRegionId(),
                mode,
                x: p.x,
                y: p.y,
                w: 0,
                h: 0,
                fill: '#000000',
              });
            }}
            onPointerMove={(e) => {
              if (!drawing) return;
              const p = pointIn(e);
              if (!p) return;
              setDrawing({
                ...drawing,
                w: Math.abs(p.x - drawing.x),
                h: Math.abs(p.y - drawing.y),
                x: Math.min(p.x, drawing.x),
                y: Math.min(p.y, drawing.y),
              });
            }}
            onPointerUp={() => {
              if (!drawing) return;
              if (drawing.w > 0.01 && drawing.h > 0.01) {
                patchEdit({ regions: [...edit.regions, drawing] });
              }
              setDrawing(null);
            }}
          >
            {url ? (
              <video
                ref={videoRef}
                src={url}
                controls
                onLoadedMetadata={onMeta}
                className="preview-video"
              />
            ) : (
              <Spinner label={t('ed_open_spin')} />
            )}
            {[...edit.regions, ...(drawing ? [drawing] : [])].map((r) => (
              <div
                key={r.id}
                className={r.mode === 'fill' ? 'redact redact--fill' : 'redact redact--cosmetic'}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                }}
              >
                {r.mode !== 'fill' && t('cosmetic_tag')}
              </div>
            ))}
          </div>
          <p className="muted">
            {t('ed_draw_hint_1', { label: t(LABEL_KEY[mode]) })}
            <strong>{t('ed_draw_hint_strong')}</strong>
            {t('ed_draw_hint_2')}
          </p>
        </div>

        {/* TIMELINE + TRIM — v1, and deliberately so: seconds cut megabytes
            linearly and without quality loss, which makes trim the strongest lever
            the target-size feature has (design §2.6, §14.1). */}
        <div className="timeline">
          <div className="track">
            <div
              className="trim-window"
              style={{
                left: `${(edit.trimInMs / Math.max(1, duration)) * 100}%`,
                right: `${(1 - edit.trimOutMs / Math.max(1, duration)) * 100}%`,
              }}
            />
          </div>
          <div className="trim-inputs">
            <label>
              {t('tl_start')}
              <input
                type="range"
                min={0}
                max={duration}
                value={edit.trimInMs}
                onChange={(e) =>
                  patchEdit({ trimInMs: Math.min(Number(e.target.value), edit.trimOutMs - 100) })
                }
              />
            </label>
            <label>
              {t('tl_end')}
              <input
                type="range"
                min={0}
                max={duration}
                value={edit.trimOutMs}
                onChange={(e) =>
                  patchEdit({ trimOutMs: Math.max(Number(e.target.value), edit.trimInMs + 100) })
                }
              />
            </label>
          </div>
          <p className="muted mono">
            {t('ed_trim_summary', {
              in: formatDuration(edit.trimInMs),
              out: formatDuration(edit.trimOutMs),
              trimmed: formatDuration(trimmed),
              dur: formatDuration(duration),
            })}
          </p>
        </div>
      </div>

      <aside className="editor-side">
        <h3>{t('ed_layers')}</h3>
        <ul className="layers">
          {fills.length > 0 && <li>{t('ed_layer_fill', { n: fills.length })}</li>}
          {cosmetic.length > 0 && (
            <li className="warn-text">{t('ed_layer_cosmetic', { n: cosmetic.length })}</li>
          )}
          {edit.watermark && <li>{t('ed_layer_watermark')}</li>}
          {edit.regions.length === 0 && !edit.watermark && (
            <li className="muted">{t('ed_layer_empty')}</li>
          )}
        </ul>

        {/* GROUP 1 — the ONLY protection group. */}
        <div className="tool-group">
          <h4>{t('ed_hide_group')}</h4>
          <label className="radio-inline">
            <input type="radio" checked={mode === 'fill'} onChange={() => setMode('fill')} />
            {t('label_fill')}
          </label>
          <p className="muted">
            {t('ed_fill_desc_1')}
            <strong>{t('ed_fill_desc_strong')}</strong>
            {t('ed_fill_desc_2')}
          </p>
        </div>

        {/* GROUP 2 — physically separate, with a warning that cannot be collapsed. */}
        <div className="tool-group tool-group--cosmetic">
          <h4>{t('ed_cosmetic_group')}</h4>
          <label className="radio-inline">
            <input type="radio" checked={mode === 'blur'} onChange={() => setMode('blur')} />
            {t('label_blur')}
          </label>
          <label className="radio-inline">
            <input
              type="radio"
              checked={mode === 'pixelate'}
              onChange={() => setMode('pixelate')}
            />
            {t('label_pixelate')}
          </label>
          <Callout tone="warn">
            <strong>{t('ed_cosmetic_warn_strong')}</strong> {t('ed_cosmetic_warn_body')}
            <details>
              <summary>{t('ed_why')}</summary>
              {t('ed_cosmetic_why_body')}
            </details>
          </Callout>
        </div>

        {edit.regions.length > 0 && (
          <div className="tool-group">
            <h4>{t('ed_areas')}</h4>
            {edit.regions.map((r) => (
              <div key={r.id} className="region-row">
                <span>{t(LABEL_KEY[r.mode])}</span>
                {r.mode === 'fill' && (
                  <input
                    type="color"
                    value={r.fill ?? '#000000'}
                    aria-label={t('ed_fill_color_aria')}
                    onChange={(e) =>
                      patchEdit({
                        regions: edit.regions.map((x) =>
                          x.id === r.id ? { ...x, fill: e.target.value } : x,
                        ),
                      })
                    }
                  />
                )}
                <button
                  type="button"
                  className="ui-btn ui-btn--sm"
                  onClick={() =>
                    patchEdit({ regions: edit.regions.filter((x) => x.id !== r.id) })
                  }
                >
                  {t('delete')}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="tool-group">
          <h4>{t('ed_layer_watermark')}</h4>
          <p className="muted">{t('ed_wm_desc')}</p>
          <label className="check-inline">
            <input
              type="checkbox"
              checked={!!edit.watermark}
              onChange={(e) =>
                patchEdit({
                  watermark: e.target.checked
                    ? {
                        text: prefs.watermarkText || '© ',
                        position: prefs.watermarkPosition,
                        opacity: prefs.watermarkOpacity,
                        sizePct: prefs.watermarkSizePct,
                      }
                    : null,
                })
              }
            />
            {t('ed_wm_apply')}
          </label>
          {edit.watermark && (
            <input
              type="text"
              value={edit.watermark.text}
              aria-label={t('ed_wm_text_aria')}
              onChange={(e) =>
                patchEdit({
                  watermark: { ...edit.watermark!, text: e.target.value },
                })
              }
            />
          )}
        </div>

        <Button variant="primary" onClick={onExport}>
          {t('ed_export_btn')}
        </Button>
      </aside>
    </div>
  );
}
