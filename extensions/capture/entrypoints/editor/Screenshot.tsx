import { useState } from 'react';
import { Button, Callout, MockBadge } from '@blur/ui';
import type { RedactionMode } from '../../utils/types';

// Screenshot editor (design capture.md §2.11, §4.2). Same redaction rules as the
// clip editor (SOLID FILL = protection; blur/pixelate = cosmetic, separated and
// warned), plus image-specific format/scale and the DPR honesty line. The pixel
// fill is stubbed (utils/media.ts); the tool UI is real.

export function Screenshot({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<RedactionMode>('fill');
  const [fills, setFills] = useState(2);
  const [cosmetic, setCosmetic] = useState(1);

  return (
    <div className="shot">
      <MockBadge />
      <header className="ed-head">
        <h2>Скриншот · example.com/login</h2>
        <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
          ✕
        </button>
      </header>

      <div className="shot-grid">
        <aside className="shot-tools">
          {/* GROUP 1 — protection. Fill is preselected; "hide a password" cannot
              miss it (design §7.2). */}
          <div className="tool-group">
            <h4>🔒 Скрыть данные</h4>
            <label className="radio-inline">
              <input
                type="radio"
                checked={mode === 'fill'}
                onChange={() => setMode('fill')}
              />
              Заливка — непрозрачный прямоугольник, пиксели удаляются навсегда
            </label>
            <input type="color" defaultValue="#000000" aria-label="Цвет заливки" />
            <Button variant="primary" onClick={() => setFills((n) => n + 1)}>
              + Область заливки
            </Button>
          </div>

          {/* GROUP 2 — cosmetic, physically separate, non-collapsible warning. */}
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
              Блюр и пиксели <strong>ОБРАТИМЫ</strong>. Unredacter и Depix
              восстанавливают из них текст — пароли и ключи в том числе. Для
              секретов берите заливку.{' '}
              <details>
                <summary>Почему?</summary>
                Bishop Fox (Unredacter, 2022) и Depix брутфорсом восстанавливают
                пикселизованный текст; блюр — обратимая свёртка. Прямая
                рекомендация: «Never use text pixelation to redact sensitive
                information».
              </details>
            </Callout>
            {mode !== 'fill' && (
              <Button variant="ghost" onClick={() => setCosmetic((n) => n + 1)}>
                + Косметическая область
              </Button>
            )}
          </div>
        </aside>

        <div className="shot-preview">
          {/* Neutral checkerboard so a black fill never blends into the page bg
              (design §11.3). */}
          <div className="preview-frame preview-frame--shot">
            <p className="mono">Логин: admin@example.com</p>
            <p className="mono">
              Пароль: <span className="redact redact--fill inline">████████████</span>
            </p>
            <p className="mono">
              Токен: <span className="redact redact--fill inline">██████████████████</span>
            </p>
            {cosmetic > 0 && (
              <span className="redact redact--cosmetic inline">размыто · косметика</span>
            )}
          </div>

          <p className="muted">Скрыто заливкой: {fills} области</p>
          <p className="warn-text">Размыто (не защита): {cosmetic} область</p>

          <div className="shot-out">
            <label>
              Формат
              <select defaultValue="png">
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </label>
            <label>
              Масштаб
              <select defaultValue="1">
                <option value="1">1× (2560px)</option>
                <option value="0.5">0.5× (1280px)</option>
              </select>
            </label>
          </div>
          {/* DPR honesty: the file is in PHYSICAL pixels (design §6.6, §8). */}
          <p className="muted">ⓘ Снимок в физических пикселях: DPR 2× (экран 1280 → файл 2560).</p>

          <div className="ed-foot">
            <Button variant="ghost">Копировать</Button>
            <Button variant="primary">Сохранить</Button>
          </div>
          <Callout tone="info">
            После сохранения исходный снимок с паролем останется в библиотеке.{' '}
            <button type="button" className="ui-btn ui-btn--sm">
              Удалить исходник
            </button>
          </Callout>
        </div>
      </div>
    </div>
  );
}
