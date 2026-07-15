import { useEffect, useRef, useState, type ReactNode } from 'react';
import { browser } from '#imports';
import { Button, Callout, ThemeToggle, type Theme } from '@blur/ui';
import { deleteClip, listClips, putBlob, pruneOlderThan, storageEstimate } from '../../utils/db';
import { formatBytes } from '../../utils/format';
import { capabilities } from '../../utils/platform';
import { DEFAULT_SIZE_PRESETS, LOGO_BLOB_KEY } from '../../utils/storage';
import { usePrefs } from '../../utils/use-prefs';
import { useCaptureTheme } from '../../utils/use-theme';

// SETTINGS (design capture.md §2.12). Shared by the Studio tab AND the standalone
// options page — one component, one source of truth, so the two can never drift.
//
// Degradations are shown by EXPLAINING, never by a disabled control (design §8):
// a greyed-out checkbox reads as "I configured something wrong", an explanation
// reads as "the browser cannot do this". So on Firefox the tab-audio and MP4 rows
// carry a sentence, not a dead switch.

const caps = capabilities();

export function Settings() {
  const { prefs, update, error } = usePrefs();
  const { theme, setTheme } = useCaptureTheme();
  const [used, setUsed] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [wipeArmed, setWipeArmed] = useState(false);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    void Promise.all([storageEstimate(), listClips()]).then(([est, clips]) => {
      setUsed(est.used);
      setCount(clips.length);
    });

  useEffect(refresh, []);

  return (
    <div className="settings">
      {error && (
        <Callout tone="poor" title="Настройки не сохранены">
          {error}
        </Callout>
      )}
      {note && <Callout tone="info">{note}</Callout>}

      <section className="set-group">
        <h3>Запись</h3>

        <Row label="Разрешение по умолчанию">
          <select
            value={prefs.defaultResolution?.height ?? 0}
            onChange={(e) => {
              const h = Number(e.target.value);
              update({
                defaultResolution: h ? { width: Math.round((h * 16) / 9), height: h } : null,
              });
            }}
          >
            <option value={0}>Как есть</option>
            <option value={1080}>1080p</option>
            <option value={720}>720p</option>
            <option value={480}>480p</option>
          </select>
        </Row>

        <Row label="Частота кадров">
          <select
            value={prefs.defaultFps}
            onChange={(e) => update({ defaultFps: Number(e.target.value) })}
          >
            <option value={60}>60 к/с</option>
            <option value={30}>30 к/с</option>
            <option value={25}>25 к/с</option>
            <option value={15}>15 к/с</option>
          </select>
          {prefs.defaultFps === 60 && (
            <span className="warn-text"> 60 к/с — это ×2 к размеру при том же качестве.</span>
          )}
        </Row>

        <Row label="Формат записи">
          {caps.canRecordMp4 ? (
            <select
              value={prefs.defaultVideoFormat}
              onChange={(e) =>
                update({ defaultVideoFormat: e.target.value === 'mp4' ? 'mp4' : 'webm' })
              }
            >
              <option value="mp4">MP4 (H.264)</option>
              <option value="webm">WebM (VP9)</option>
            </select>
          ) : (
            <span className="warn-text">
              Этот браузер пишет только WebM — MediaRecorder не отдаёт MP4. MP4 получится на
              экспорте (перекодирование).
            </span>
          )}
        </Row>

        <Row label="Качество записи">
          <select
            value={prefs.defaultQuality}
            onChange={(e) =>
              update({ defaultQuality: e.target.value as 'high' | 'medium' | 'low' })
            }
          >
            <option value="high">Высокое</option>
            <option value="medium">Среднее</option>
            <option value="low">Низкое</option>
          </select>
          <span className="muted">
            {' '}
            Браузер может не послушаться — точный размер задаётся на экспорте.
          </span>
        </Row>

        <Row label="Звук вкладки">
          {caps.canRecordTabAudio ? (
            <input
              type="checkbox"
              checked={prefs.tabAudio}
              onChange={(e) => update({ tabAudio: e.target.checked })}
            />
          ) : (
            <span className="warn-text">
              В Firefox невозможно: <code>getDisplayMedia</code> не отдаёт аудиодорожку. Это
              отсутствующая возможность браузера, а не наша настройка. Доступен только
              микрофон.
            </span>
          )}
        </Row>

        <Row label="Микрофон">
          <input
            type="checkbox"
            checked={prefs.mic}
            onChange={(e) => update({ mic: e.target.checked })}
          />
          <span className="muted">
            {' '}
            Разрешение спрашивается с видимой страницы — невидимый offscreen-документ этого не
            умеет.
          </span>
        </Row>

        <Row label="Открывать окно записи">
          <input
            type="checkbox"
            checked={caps.pipeline === 'firefox-window' ? true : prefs.openRecorderWindow}
            disabled={caps.pipeline === 'firefox-window'}
            onChange={(e) => update({ openRecorderWindow: e.target.checked })}
          />
          {caps.pipeline === 'firefox-window' && (
            <span className="muted"> В Firefox окно обязательно: запись живёт в нём.</span>
          )}
        </Row>
      </section>

      <section className="set-group">
        <h3>Экспорт</h3>

        <Row label="Максимум проходов подгонки">
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
          <span className="muted">
            {' '}
            Больше проходов — точнее попадание, но дольше. Один проход — это просто «задать
            битрейт», попадание случайно.
          </span>
        </Row>

        <Row label="Куда сохранять">
          <label className="check-inline">
            <input
              type="checkbox"
              checked={prefs.askWhereToSave}
              onChange={(e) => update({ askWhereToSave: e.target.checked })}
            />
            Спрашивать
          </label>
        </Row>

        <Row label="Шаблон имени">
          <input
            type="text"
            value={prefs.filenameTemplate}
            onChange={(e) => update({ filenameTemplate: e.target.value })}
          />
          <span className="muted"> {'{host}'} · {'{date}'} · {'{time}'} — имя санитизируется.</span>
        </Row>

        <div className="set-row">
          <h4>Лимиты площадок</h4>
          <p className="muted">
            Зашиты локально и могут устареть — в сеть за ними мы не ходим (её у расширения нет
            вовсе). Поэтому их можно поправить.
          </p>
          {prefs.sizePresets.map((p) => (
            <div key={p.id} className="preset-row">
              <span>{p.label}</span>
              <input
                type="number"
                min={1}
                value={Math.round(p.bytes / 1024 / 1024)}
                aria-label={`${p.label}, МБ`}
                onChange={(e) =>
                  update({
                    sizePresets: prefs.sizePresets.map((x) =>
                      x.id === p.id
                        ? { ...x, bytes: Math.max(1, Number(e.target.value)) * 1024 * 1024 }
                        : x,
                    ),
                  })
                }
              />
              <span className="muted">МБ</span>
            </div>
          ))}
          <Button variant="ghost" onClick={() => update({ sizePresets: DEFAULT_SIZE_PRESETS })}>
            Вернуть значения по умолчанию
          </Button>
        </div>
      </section>

      <section className="set-group">
        <h3>Watermark</h3>
        <Row label="Текст">
          <input
            type="text"
            value={prefs.watermarkText}
            onChange={(e) => update({ watermarkText: e.target.value })}
          />
        </Row>
        <Row label="Логотип">
          <input
            ref={logoRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void putBlob(LOGO_BLOB_KEY, f).then(() => setLogoName(f.name));
            }}
          />
          {logoName && <span className="muted"> {logoName}</span>}
          <p className="muted">
            🔴 Только локальный файл. Поля «ссылка на логотип» нет намеренно: внешняя картинка
            без CORS делает канвас tainted, и <code>convertToBlob()</code> падает в САМОМ КОНЦЕ
            экспорта — после минут кодирования.
          </p>
        </Row>
        <Row label="Положение">
          <select
            value={prefs.watermarkPosition}
            onChange={(e) =>
              update({ watermarkPosition: e.target.value as typeof prefs.watermarkPosition })
            }
          >
            <option value="bottom-right">Справа снизу</option>
            <option value="bottom-left">Слева снизу</option>
            <option value="top-right">Справа сверху</option>
            <option value="top-left">Слева сверху</option>
            <option value="center">По центру</option>
          </select>
        </Row>
        <Row label="Прозрачность">
          <input
            type="range"
            min={10}
            max={100}
            value={prefs.watermarkOpacity}
            onChange={(e) => update({ watermarkOpacity: Number(e.target.value) })}
          />
          <span className="mono"> {prefs.watermarkOpacity}%</span>
        </Row>
        <Row label="Размер (% высоты кадра)">
          <input
            type="range"
            min={2}
            max={20}
            value={prefs.watermarkSizePct}
            onChange={(e) => update({ watermarkSizePct: Number(e.target.value) })}
          />
          <span className="mono"> {prefs.watermarkSizePct}%</span>
        </Row>
      </section>

      <section className="set-group">
        <h3>Хранилище</h3>
        <p className="mono">
          Занято: {used != null ? formatBytes(used) : '—'} · {count} записей
        </p>
        <p className="muted">
          Записи лежат только на этом компьютере, в профиле браузера (IndexedDB). Никуда не
          отправляются — у расширения нет ни одного сетевого запроса. Удаление расширения
          удалит и их.
        </p>
        <Row label="Автоудаление записей старше">
          <select
            value={prefs.autoDeleteDays ?? 0}
            onChange={(e) => {
              const d = Number(e.target.value);
              update({ autoDeleteDays: d || null });
              if (d) void pruneOlderThan(d).then((n) => {
                setNote(n ? `Удалено записей: ${n}.` : 'Нечего удалять.');
                refresh();
              });
            }}
          >
            {/* Default is NEVER, deliberately: silently erasing someone's screencast
                is worse than using disk (design §3.4). */}
            <option value={0}>Никогда</option>
            <option value={7}>7 дней</option>
            <option value={30}>30 дней</option>
          </select>
        </Row>
        {/* Two-step, and it disarms on blur: deleting every recording the user has
            must never be one careless click (house rule, PLAN.md §18c). */}
        <button
          type="button"
          className={wipeArmed ? 'ui-btn ui-btn--primary' : 'ui-btn ui-btn--ghost'}
          onClick={() => {
            if (!wipeArmed) {
              setWipeArmed(true);
              return;
            }
            void listClips()
              .then((cs) => Promise.all(cs.map((c) => deleteClip(c.id))))
              .then(() => {
                setWipeArmed(false);
                setNote('Все записи удалены.');
                refresh();
              });
          }}
          onBlur={() => setWipeArmed(false)}
        >
          {wipeArmed ? `Точно удалить все ${count} записей?` : 'Удалить все записи'}
        </button>
      </section>

      <section className="set-group">
        <h3>Горячие клавиши</h3>
        <p className="mono">
          Запись Alt+Shift+R · Стоп Alt+Shift+S · Пауза Alt+Shift+P · Скриншот Alt+Shift+A
        </p>
        <p className="muted">
          Работают из любого окна и любой вкладки — включая полноэкранное видео и другое
          приложение. Изменить можно в самом браузере (страница управления расширениями).
        </p>
        <Button
          variant="ghost"
          onClick={() =>
            void browser.tabs
              .create({
                url: import.meta.env.FIREFOX
                  ? 'about:addons'
                  : 'chrome://extensions/shortcuts',
              })
              .catch(() => setNote('Откройте страницу расширений браузера вручную.'))
          }
        >
          Изменить в браузере
        </Button>
      </section>

      <section className="set-group">
        <h3>Тема</h3>
        {theme && <ThemeToggle theme={theme} onChange={(t: Theme) => setTheme(t)} />}
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <span className="set-label">{label}</span>
      <span className="set-ctl">{children}</span>
    </div>
  );
}
