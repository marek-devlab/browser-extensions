import { useState } from 'react';
import { Button, Callout, MockBadge } from '@blur/ui';
import { formatDuration } from '../../utils/format';
import type { Clip, RedactionMode, RedactionRegion } from '../../utils/types';

// Clip editor (design capture.md §2.6). Preview + timeline + trim + the redaction/
// watermark/text panels. The UI and layer model are REAL; the pixel operations
// (fill/blur/pixelate, watermark compositing) are stubbed in utils/media.ts.
//
// REDACTION is the security-critical surface (design §7): SOLID FILL is the ONLY
// protection mode and lives alone under "Скрыть данные"; blur & pixelate are
// physically separated into a "Косметика — НЕ защита" group with a
// non-collapsible reversibility warning (Unredacter/Depix). A user hunting for
// "how to hide a password" cannot miss the fill (design §7.2, §7.3).

let seq = 0;
const nid = () => `r-${++seq}`;

export function ClipEditor({
  clip,
  onExport,
}: {
  clip: Clip;
  onExport: () => void;
}) {
  const [regions, setRegions] = useState<RedactionRegion[]>([]);
  const [trimIn, setTrimIn] = useState(8000);
  const [trimOut, setTrimOut] = useState(clip.durationMs - 22000);
  const [watermark, setWatermark] = useState(false);

  const fills = regions.filter((r) => r.mode === 'fill');
  const cosmetic = regions.filter((r) => r.mode !== 'fill');
  const trimmed = Math.max(0, trimOut - trimIn);

  function addRegion(mode: RedactionMode) {
    setRegions((rs) => [
      ...rs,
      { id: nid(), mode, x: 0.35, y: 0.3, w: 0.3, h: 0.12, fill: '#000000' },
    ]);
  }
  function removeRegion(id: string) {
    setRegions((rs) => rs.filter((r) => r.id !== id));
  }

  return (
    <div className="editor-grid">
      <div className="editor-main">
        <MockBadge />
        {/* Preview on a neutral CHECKERBOARD, never --bg: a black fill must not
            blend into a dark page background (design §11.3). */}
        <div className="preview" role="img" aria-label="Предпросмотр кадра">
          <div className="preview-frame">
            {fills.map((r) => (
              <div
                key={r.id}
                className="redact redact--fill"
                style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
              />
            ))}
            {cosmetic.map((r) => (
              // Cosmetic regions draw with a DASHED amber "косметика" border so the
              // difference is visible to the eye, not just in text (design §7.3).
              <div
                key={r.id}
                className="redact redact--cosmetic"
                style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
              >
                косметика
              </div>
            ))}
            {watermark && <span className="wm-preview">© acme.co</span>}
          </div>
        </div>

        <div className="transport mono">
          ◀◀ ▶ ▶▶ &nbsp; {formatDuration(trimIn)} / {formatDuration(clip.durationMs)}
        </div>

        {/* TIMELINE + TRIM (v1 — the strongest size lever, design §2.6, §14.1). */}
        <div className="timeline">
          <div className="track">
            <div
              className="trim-window"
              style={{
                left: `${(trimIn / clip.durationMs) * 100}%`,
                right: `${(1 - trimOut / clip.durationMs) * 100}%`,
              }}
            />
          </div>
          <div className="trim-inputs">
            <label>
              ◀ обрезка
              <input
                type="range"
                min={0}
                max={clip.durationMs}
                value={trimIn}
                onChange={(e) => setTrimIn(Math.min(Number(e.target.value), trimOut))}
              />
            </label>
            <label>
              обрезка ▶
              <input
                type="range"
                min={0}
                max={clip.durationMs}
                value={trimOut}
                onChange={(e) => setTrimOut(Math.max(Number(e.target.value), trimIn))}
              />
            </label>
          </div>
          <p className="muted">
            Длительность после обрезки: {formatDuration(trimmed)} (было{' '}
            {formatDuration(clip.durationMs)})
          </p>
        </div>
      </div>

      <aside className="editor-side">
        <h3>Слои</h3>
        <ul className="layers">
          {fills.length > 0 && (
            <li>🔒 Заливка ×{fills.length}</li>
          )}
          {cosmetic.length > 0 && (
            <li className="warn-text">⚠ Косметика ×{cosmetic.length} — не защита</li>
          )}
          {watermark && <li>💧 Watermark — справа снизу</li>}
          {regions.length === 0 && !watermark && <li className="muted">Пусто</li>}
        </ul>

        {/* GROUP 1 — the ONLY protection group. */}
        <div className="tool-group">
          <h4>🔒 Скрыть данные</h4>
          <p className="muted">
            Заливка: пиксели под прямоугольником <strong>удаляются</strong> и
            заменяются сплошным цветом. Восстановить из файла невозможно.
          </p>
          <Button variant="primary" onClick={() => addRegion('fill')}>
            + Заливка (защита)
          </Button>
          {fills.map((r) => (
            <RegionRow key={r.id} region={r} onRemove={() => removeRegion(r.id)} />
          ))}
        </div>

        {/* GROUP 2 — physically separate, non-collapsible warning (design §7.3). */}
        <div className="tool-group tool-group--cosmetic">
          <h4>⚠ Косметика — не защита</h4>
          <Callout tone="warn">
            <strong>Блюр и пикселизация обратимы.</strong> Инструменты Unredacter и
            Depix восстанавливают текст из размытого и пикселизованного
            изображения — включая пароли, ключи и номера карт. Это не теория: их
            авторы делали это публично. Для секретов берите заливку.
          </Callout>
          <div className="cosmetic-btns">
            <Button variant="ghost" onClick={() => addRegion('blur')}>
              + Блюр
            </Button>
            <Button variant="ghost" onClick={() => addRegion('pixelate')}>
              + Пикселизация
            </Button>
          </div>
          {cosmetic.map((r) => (
            <RegionRow key={r.id} region={r} onRemove={() => removeRegion(r.id)} />
          ))}
        </div>

        <div className="tool-group">
          <h4>💧 Watermark / T Текст</h4>
          <p className="muted">
            Добавляется при экспорте — так его можно поменять или снять, не
            переснимая (design §4.5).
          </p>
          <label className="check-inline">
            <input
              type="checkbox"
              checked={watermark}
              onChange={(e) => setWatermark(e.target.checked)}
            />
            Наложить «© acme.co» справа снизу
          </label>
        </div>

        <Button variant="primary" onClick={onExport}>
          Экспорт →
        </Button>
      </aside>
    </div>
  );
}

function RegionRow({
  region,
  onRemove,
}: {
  region: RedactionRegion;
  onRemove: () => void;
}) {
  const label =
    region.mode === 'fill' ? 'Заливка' : region.mode === 'blur' ? 'Блюр' : 'Пикселизация';
  return (
    <div className="region-row">
      <span>{label}</span>
      {region.mode === 'fill' && (
        <input type="color" defaultValue={region.fill ?? '#000000'} aria-label="Цвет заливки" />
      )}
      <button type="button" className="ui-btn ui-btn--sm" onClick={onRemove}>
        Удалить
      </button>
    </div>
  );
}
