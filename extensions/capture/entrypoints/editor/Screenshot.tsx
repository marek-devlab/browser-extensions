import { useEffect, useRef, useState } from 'react';
import { Button, Callout, Spinner } from '@blur/ui';
import { clipBlob, deleteClip, getBlob } from '../../utils/db';
import { newRegionId } from '../../utils/edit-store';
import {
  encodeImageToTarget,
  loadLogo,
  renderScreenshot,
  type Composite,
} from '../../utils/encode';
import { expandTemplate, formatBytes } from '../../utils/format';
import { saveBlob } from '../../utils/save';
import { LOGO_BLOB_KEY } from '../../utils/storage';
import { usePrefs } from '../../utils/use-prefs';
import type { Clip, RedactionMode, RedactionRegion, ScreenshotFormat } from '../../utils/types';

// SCREENSHOT EDITOR (design capture.md §2.11, §4.2).
//
// This is where passwords actually live — which is exactly why redaction is a v1
// feature and not a v2 one (design §14.1): shipping a screenshot tool with no way
// to cover a password is shipping the leak.
//
// Same two-group rule as the video editor, for the same reason: someone in a hurry
// reads the FIRST heading and stops. So the first heading is «Скрыть данные» and
// the only thing under it is the solid fill. Blur and pixelate sit below, under
// «Косметика — НЕ защита», with a warning that does not fold away (§7.2, §7.3).
//
// ⚠️ DPR: the file is in PHYSICAL pixels (PLAN.md §6.2). We show the real number.
// And every rectangle is stored as a FRACTION of the frame, then multiplied by the
// bitmap's true pixel size at render — so the classic "the selection was in CSS
// pixels, the bitmap was in device pixels, the black box landed 40 px off" bug
// cannot occur here at all.

export function Screenshot({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const { prefs, update } = usePrefs();
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [regions, setRegions] = useState<RedactionRegion[]>([]);
  const [mode, setMode] = useState<RedactionMode>('fill');
  const [fillColor, setFillColor] = useState('#000000');
  const [format, setFormat] = useState<ScreenshotFormat>(prefs.defaultScreenshotFormat);
  const [scale, setScale] = useState(1);
  const [targetKb, setTargetKb] = useState<number | null>(null);
  const [drawing, setDrawing] = useState<RedactionRegion | null>(null);
  const [saved, setSaved] = useState<{ bytes: number; quality?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let u: string | null = null;
    void clipBlob(clip)
      .then(async (b) => {
        const bmp = await createImageBitmap(b);
        if (!alive) {
          bmp.close();
          return;
        }
        u = URL.createObjectURL(b);
        setUrl(u);
        setBitmap(bmp);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [clip]);

  // The bitmap is a GPU/CPU resource, not garbage-collected on a whim. Close it.
  useEffect(() => () => bitmap?.close(), [bitmap]);

  const fills = regions.filter((r) => r.mode === 'fill').length;
  const cosmetic = regions.length - fills;

  function pointIn(e: React.PointerEvent): { x: number; y: number } | null {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  }

  async function save(copy = false) {
    if (!bitmap) return;
    setBusy(true);
    setError(null);
    try {
      const logoBlob = await getBlob(LOGO_BLOB_KEY);
      const composite: Composite = {
        regions,
        watermark: prefs.watermarkByDefault
          ? {
              text: prefs.watermarkText,
              position: prefs.watermarkPosition,
              opacity: prefs.watermarkOpacity,
              sizePct: prefs.watermarkSizePct,
            }
          : null,
        logo: await loadLogo(logoBlob ?? null),
      };

      let out;
      if (targetKb && format !== 'png') {
        out = await encodeImageToTarget(
          bitmap,
          composite,
          targetKb * 1024,
          format === 'jpeg' ? 'jpeg' : 'webp',
          scale,
        );
      } else {
        out = await renderScreenshot(bitmap, composite, format, scale);
      }
      composite.logo?.close();

      if (copy) {
        // clipboardWrite is NOT declared (an unused permission is a review flag),
        // and the async clipboard API works from a focused extension page without
        // it. If the browser refuses, we say so instead of pretending it worked.
        await navigator.clipboard.write([new ClipboardItem({ [out.blob.type]: out.blob })]);
        setSaved({ bytes: out.blob.size });
        return;
      }

      const filename = expandTemplate(prefs.filenameTemplate, {
        host: clip.host || 'screenshot',
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toTimeString().slice(0, 5).replace(':', ''),
      });
      await saveBlob({
        blob: out.blob,
        basename: filename,
        extension: format === 'jpeg' ? 'jpg' : format,
        askWhereToSave: prefs.askWhereToSave,
      });
      setSaved({
        bytes: out.blob.size,
        quality: 'quality' in out ? (out as { quality: number }).quality : undefined,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось сохранить. Исходный снимок остался в библиотеке.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (error && !bitmap) {
    return (
      <Callout tone="warn" title="Не удалось открыть снимок">
        {error}
      </Callout>
    );
  }
  if (!bitmap || !url) return <Spinner label="Открываем снимок…" />;

  return (
    <div className="shot">
      <header className="ed-head">
        <h2>{clip.title}</h2>
        <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
          ✕
        </button>
      </header>

      <div className="shot-grid">
        <aside className="shot-tools">
          {/* GROUP 1 — protection. Fill is preselected, so someone looking for
              "how do I cover this password" cannot physically miss it (§7.2). */}
          <div className="tool-group">
            <h4>🔒 Скрыть данные</h4>
            <label className="radio-inline">
              <input type="radio" checked={mode === 'fill'} onChange={() => setMode('fill')} />
              Заливка
            </label>
            <p className="muted">
              Непрозрачный прямоугольник. Пиксели под ним <strong>удаляются</strong> и
              заменяются цветом — восстановить их из файла невозможно. В файл не пишется ни
              слоя, ни метаданных о заливке: только результат.
            </p>
            <input
              type="color"
              value={fillColor}
              aria-label="Цвет заливки"
              onChange={(e) => setFillColor(e.target.value)}
            />
          </div>

          {/* GROUP 2 — cosmetic. Physically separate; the warning does not fold. */}
          <div className="tool-group tool-group--cosmetic">
            <h4>⚠ Косметика — НЕ защита</h4>
            <label className="radio-inline">
              <input type="radio" checked={mode === 'blur'} onChange={() => setMode('blur')} />
              Блюр
            </label>
            <label className="radio-inline">
              <input
                type="radio"
                checked={mode === 'pixelate'}
                onChange={() => setMode('pixelate')}
              />
              Пикселизация
            </label>
            <Callout tone="warn">
              <strong>Блюр и пиксели ОБРАТИМЫ.</strong> Unredacter и Depix восстанавливают из
              них текст — пароли и ключи в том числе. Для секретов берите заливку.
              <details>
                <summary>Почему?</summary>
                Bishop Fox (Unredacter, 2022) и Depix публично восстанавливали
                пикселизованный текст перебором; блюр — обратимая свёртка. Прямая
                рекомендация исследователей: «Never use text pixelation to redact sensitive
                information».
              </details>
            </Callout>
          </div>
        </aside>

        <div className="shot-preview">
          <div
            className="preview-frame preview-frame--shot"
            ref={frameRef}
            onPointerDown={(e) => {
              const p = pointIn(e);
              if (!p) return;
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setDrawing({ id: newRegionId(), mode, x: p.x, y: p.y, w: 0, h: 0, fill: fillColor });
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
              if (drawing.w > 0.005 && drawing.h > 0.005) setRegions((rs) => [...rs, drawing]);
              setDrawing(null);
            }}
          >
            <img src={url} alt="Снимок вкладки" className="shot-img" />
            {[...regions, ...(drawing ? [drawing] : [])].map((r) => (
              <div
                key={r.id}
                className={r.mode === 'fill' ? 'redact redact--fill' : 'redact redact--cosmetic'}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                  ...(r.mode === 'fill' ? { background: r.fill } : {}),
                }}
              >
                {r.mode !== 'fill' && 'косметика'}
              </div>
            ))}
          </div>

          <p className="muted">Тяните мышью по снимку, чтобы добавить область.</p>
          <p className="muted">🔒 Скрыто заливкой: {fills} обл.</p>
          {cosmetic > 0 && (
            <p className="warn-text">
              ⚠ Размыто (НЕ защита): {cosmetic} обл. — если там секрет, замените на заливку.
            </p>
          )}
          {regions.length > 0 && (
            <Button variant="ghost" onClick={() => setRegions([])}>
              Убрать все области
            </Button>
          )}

          <div className="shot-out">
            <label>
              Формат
              <select
                value={format}
                onChange={(e) => {
                  const f = e.target.value as ScreenshotFormat;
                  setFormat(f);
                  update({ defaultScreenshotFormat: f });
                }}
              >
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </label>
            <label>
              Масштаб
              <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                <option value={1}>1× ({bitmap.width}px)</option>
                <option value={0.5}>0.5× ({Math.round(bitmap.width / 2)}px)</option>
              </select>
            </label>
            <label>
              Уложиться в
              <input
                type="number"
                min={0}
                placeholder="КБ"
                value={targetKb ?? ''}
                onChange={(e) => setTargetKb(e.target.value ? Number(e.target.value) : null)}
              />
            </label>
          </div>
          {targetKb && format === 'png' && (
            <Callout tone="warn">
              PNG — формат <strong>без потерь</strong>: до размера он не сжимается, параметр
              качества на него не действует. Чтобы уложиться в {targetKb} КБ, перейдите на
              JPEG или WebP.
            </Callout>
          )}

          {/* DPR honesty: the file is in physical pixels (design §6.6, §8). */}
          <p className="muted">
            ⓘ Файл в физических пикселях экрана: {bitmap.width}×{bitmap.height}. На HiDPI это
            больше, чем CSS-размер вкладки, — так работает captureVisibleTab, и мы показываем
            настоящее число.
          </p>

          {error && <Callout tone="warn">{error}</Callout>}
          {saved && (
            <Callout tone="info" title="Готово">
              Сохранено: {formatBytes(saved.bytes)}
              {saved.quality != null && ` (качество ${Math.round(saved.quality * 100)}%)`}.
              <br />
              Исходный снимок <strong>с незакрытыми данными</strong> остался в библиотеке.{' '}
              <button
                type="button"
                className="ui-btn ui-btn--sm"
                onClick={() => void deleteClip(clip.id).then(onClose)}
              >
                Удалить исходник
              </button>
            </Callout>
          )}

          <div className="ed-foot">
            <Button variant="ghost" onClick={() => void save(true)} disabled={busy}>
              Копировать
            </Button>
            <Button variant="primary" onClick={() => void save(false)} disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
