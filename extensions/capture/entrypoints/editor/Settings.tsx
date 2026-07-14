import type { ReactNode } from 'react';
import { Callout, ThemeToggle, type Theme } from '@blur/ui';
import { formatBytes } from '../../utils/format';
import { MOCK_LIBRARY, MOCK_LIBRARY_BYTES } from '../../utils/mock-data';
import { usePrefs } from '../../utils/use-prefs';
import { useCaptureTheme } from '../../utils/use-theme';

// Settings surface (design capture.md §2.12). Shared by the Studio "Настройки"
// tab AND the standalone options page. Persistence is REAL (usePrefs → prefsItem
// → sync:capturePrefs); only the storage-usage figures and "delete all" are mock.
//
// Firefox degradation is shown by EXPLAINING, not by disabled controls
// (design §8): tab audio and MP4 recording are impossible on Firefox, so those
// rows carry a warning instead of a dead checkbox.

const isFirefox = import.meta.env.FIREFOX;

export function Settings() {
  const { prefs, update, error } = usePrefs();
  const { theme, setTheme } = useCaptureTheme();

  return (
    <div className="settings">
      {error && (
        <Callout tone="poor" title="Настройки не сохранены">
          {error}
        </Callout>
      )}

      <section className="set-group">
        <h3>Запись</h3>

        <Row label="Разрешение по умолчанию">
          <select
            value={prefs.defaultResolution ? `${prefs.defaultResolution.width}` : 'asis'}
            onChange={(e) =>
              update({
                defaultResolution:
                  e.target.value === 'asis'
                    ? null
                    : { width: 1280, height: 720 },
              })
            }
          >
            <option value="asis">Как есть</option>
            <option value="1280">1280×720</option>
          </select>
        </Row>

        <Row label="Частота кадров">
          <select
            value={prefs.defaultFps}
            onChange={(e) => update({ defaultFps: Number(e.target.value) })}
          >
            {[60, 30, 25, 15].map((f) => (
              <option key={f} value={f}>
                {f} к/с
              </option>
            ))}
          </select>
        </Row>

        <Row
          label="Формат записи"
          note={isFirefox ? '⚠ Firefox: только WebM' : undefined}
        >
          {isFirefox ? (
            <select value="webm" disabled aria-label="Формат записи (Firefox: только WebM)">
              <option value="webm">WebM (VP9)</option>
            </select>
          ) : (
            <select
              value={prefs.defaultVideoFormat}
              onChange={(e) =>
                update({ defaultVideoFormat: e.target.value as 'mp4' | 'webm' })
              }
            >
              <option value="mp4">MP4 (H.264)</option>
              <option value="webm">WebM (VP9)</option>
            </select>
          )}
        </Row>

        <Row label="Звук вкладки" note={isFirefox ? '⚠ Firefox: невозможно' : undefined}>
          {isFirefox ? (
            <span className="muted">Недоступно</span>
          ) : (
            <input
              type="checkbox"
              checked={prefs.tabAudio}
              onChange={(e) => update({ tabAudio: e.target.checked })}
            />
          )}
        </Row>

        <Row label="Микрофон">
          <input
            type="checkbox"
            checked={prefs.mic}
            onChange={(e) => update({ mic: e.target.checked })}
          />
        </Row>

        <Row
          label="Открывать окно записи"
          note={isFirefox ? '⚠ Firefox: обязательно (окно = рекордер)' : undefined}
        >
          <input
            type="checkbox"
            checked={isFirefox ? true : prefs.openRecorderWindow}
            disabled={isFirefox}
            onChange={(e) => update({ openRecorderWindow: e.target.checked })}
          />
        </Row>
      </section>

      <section className="set-group">
        <h3>Экспорт</h3>
        <Row label="Формат по умолчанию">
          <select
            value={prefs.defaultExportFormat}
            onChange={(e) =>
              update({ defaultExportFormat: e.target.value as 'mp4' | 'webm' })
            }
          >
            <option value="mp4">MP4</option>
            <option value="webm">WebM</option>
          </select>
        </Row>
        <Row
          label="Максимум проходов подгонки"
          note="1–5. Больше проходов = точнее, но дольше"
        >
          <select
            value={prefs.maxPasses}
            onChange={(e) => update({ maxPasses: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Куда сохранять">
          <select
            value={prefs.askWhereToSave ? 'ask' : 'downloads'}
            onChange={(e) => update({ askWhereToSave: e.target.value === 'ask' })}
          >
            <option value="ask">Спрашивать</option>
            <option value="downloads">Папка загрузок</option>
          </select>
        </Row>
        <Row label="Шаблон имени">
          <input
            type="text"
            value={prefs.filenameTemplate}
            onChange={(e) => update({ filenameTemplate: e.target.value })}
          />
        </Row>
      </section>

      <section className="set-group">
        <h3>Watermark</h3>
        <Row label="Текст">
          <input
            type="text"
            placeholder="© acme.co"
            value={prefs.watermarkText}
            onChange={(e) => update({ watermarkText: e.target.value })}
          />
        </Row>
        <Row label="Логотип" note="⚠ только локальный файл (внешний URL пачкает canvas — §9.3)">
          <button type="button" className="ui-btn ui-btn--sm" disabled>
            Выбрать файл…
          </button>
        </Row>
        <Row label="Прозрачность">
          <input
            type="range"
            min={10}
            max={100}
            value={prefs.watermarkOpacity}
            onChange={(e) => update({ watermarkOpacity: Number(e.target.value) })}
          />
          <span className="muted mono">{prefs.watermarkOpacity}%</span>
        </Row>
      </section>

      <section className="set-group">
        <h3>Хранилище</h3>
        <p className="muted">
          Занято: {formatBytes(MOCK_LIBRARY_BYTES)} · {MOCK_LIBRARY.length} записей
        </p>
        <Row label="Автоудаление записей старше">
          <select
            value={prefs.autoDeleteDays ?? 'never'}
            onChange={(e) =>
              update({
                autoDeleteDays: e.target.value === 'never' ? null : Number(e.target.value),
              })
            }
          >
            <option value="never">Никогда</option>
            <option value="7">7 дней</option>
            <option value="30">30 дней</option>
          </select>
        </Row>
        <Callout tone="info">
          Записи лежат только на этом компьютере, в профиле браузера. Никуда не
          отправляются. Удаление расширения удалит и их.
        </Callout>
      </section>

      <section className="set-group">
        <h3>Тема</h3>
        {theme && <ThemeToggle theme={theme} onChange={(t: Theme) => setTheme(t)} />}
      </section>
    </div>
  );
}

function Row({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="set-row">
      <div className="set-row__label">
        {label}
        {note && <span className="set-row__note">{note}</span>}
      </div>
      <div className="set-row__control">{children}</div>
    </div>
  );
}
