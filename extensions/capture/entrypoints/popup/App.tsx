import { useState } from 'react';
import { browser } from '#imports';
import { Button, MockBadge } from '@blur/ui';
import { formatBytes, formatDuration } from '../../utils/format';
import { MOCK_SESSION, MOCK_LIBRARY, MOCK_LIBRARY_BYTES } from '../../utils/mock-data';
import { useTicker } from '../../utils/use-ticker';

// Popup — the 320px REMOTE, not the studio (design capture.md §1.1, §2.1). Two
// jobs only: (1) the pre-record setup form + Record/Screenshot, and (2) a
// fallback recording panel (design §2.5) when a capture is already live — a click
// on the icon during recording must NEVER show the setup form again (§2.5).
//
// The setup form and both browser variants are REAL. Starting a recording reaches
// the stubbed background orchestration; here the Record button optimistically
// flips to the recording panel (over a mock session with a REAL ticking timer)
// so both popup states are reviewable. <MockBadge/> marks the fabricated parts.

const isFirefox = import.meta.env.FIREFOX;

type View = 'setup' | 'recording';

export function App() {
  const [view, setView] = useState<View>('setup');
  const openStudio = () =>
    void browser.tabs.create({ url: browser.runtime.getURL('/editor.html') });

  return (
    <div className="popup">
      <header className="head">
        <h1>
          <span className="rec-dot" aria-hidden="true" /> Capture Studio
        </h1>
        <button
          type="button"
          className="icon-btn"
          aria-label="Настройки"
          onClick={() =>
            void browser.tabs.create({
              url: browser.runtime.getURL('/options.html'),
            })
          }
        >
          ⚙
        </button>
      </header>

      {view === 'setup' ? (
        <SetupForm onRecord={() => setView('recording')} openStudio={openStudio} />
      ) : (
        <RecordingPanel onStop={() => setView('setup')} onShowWindow={() => void showRecorder()} />
      )}
    </div>
  );
}

function showRecorder() {
  return browser.runtime.sendMessage({ type: 'recorder:focus' }).catch(() => undefined);
}

function SetupForm({
  onRecord,
  openStudio,
}: {
  onRecord: () => void;
  openStudio: () => void;
}) {
  const [source, setSource] = useState<'tab' | 'screen'>('tab');
  const [tabAudio, setTabAudio] = useState(true);
  const [mic, setMic] = useState(false);

  function record() {
    // Real path: message the background to start (Chrome: streamId→offscreen;
    // Firefox: open the recorder window). It currently reaches a todoLogic stub,
    // so we swallow the rejection and optimistically show the recording panel.
    void browser.runtime
      .sendMessage({ type: 'capture:start', source, tabAudio, mic })
      .catch(() => undefined);
    onRecord();
  }

  return (
    <>
      {/* SOURCE */}
      <section>
        <h2>Источник</h2>
        {isFirefox ? (
          // Firefox degradation is shown by REMOVING the choice and EXPLAINING —
          // never a disabled radio (design §2.2, §8).
          <p className="hint">
            Firefox спросит сам, что записывать, — своим диалогом. Мы не можем
            выбрать за вас.
          </p>
        ) : (
          <div className="radio-list">
            <label className="radio">
              <input
                type="radio"
                name="source"
                checked={source === 'tab'}
                onChange={() => setSource('tab')}
              />
              <span>
                Эта вкладка
                <em className="mono">example.com/dashboard</em>
              </span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name="source"
                checked={source === 'screen'}
                onChange={() => setSource('screen')}
              />
              <span>
                Весь экран или окно…
                <em>ⓘ потребует доступ (один раз)</em>
              </span>
            </label>
          </div>
        )}
      </section>

      {/* AUDIO */}
      <section>
        <h2>Звук</h2>
        {isFirefox ? (
          // The tab-audio checkbox is NOT rendered disabled — it is replaced by an
          // explanation (design §2.2, §8: a disabled checkbox reads as "I set
          // something wrong"; the explanation reads as "the browser can't").
          <div className="callout callout--warn" role="note">
            <strong>⚠ Звук вкладки в Firefox записать невозможно.</strong> Это
            ограничение браузера (getDisplayMedia не отдаёт аудио), а не нашей
            настройки. Доступен только микрофон.
          </div>
        ) : (
          <label className="check">
            <input
              type="checkbox"
              checked={tabAudio}
              onChange={(e) => setTabAudio(e.target.checked)}
            />
            Звук вкладки
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
          Микрофон
        </label>
        {mic && (
          <p className="hint">
            ⓘ Первый раз браузер спросит разрешение — в окне записи (промпт не
            может прийти из невидимого offscreen — §5.9).
          </p>
        )}
      </section>

      {/* QUALITY */}
      <section>
        <h2>Качество</h2>
        <div className="field">
          <label>Разрешение</label>
          <select defaultValue="asis">
            <option value="asis">Как есть (1920×1080)</option>
            <option value="720">1280×720</option>
            <option value="480">854×480</option>
          </select>
        </div>
        <div className="field">
          <label>Частота</label>
          <select defaultValue="30">
            <option value="30">30 к/с</option>
            <option value="25">25 к/с</option>
            <option value="15">15 к/с</option>
          </select>
        </div>
        <div className="field">
          <label>Формат</label>
          {isFirefox ? (
            <select defaultValue="webm">
              <option value="webm">WebM (VP9)</option>
            </select>
          ) : (
            <select defaultValue="mp4">
              <option value="mp4">MP4 (H.264)</option>
              <option value="webm">WebM (VP9)</option>
            </select>
          )}
        </div>
        {isFirefox ? (
          <p className="hint">
            ⚠ Firefox пишет только WebM. MP4 доступен на шаге экспорта
            (перекодирование, ~1–3 мин).
          </p>
        ) : (
          <p className="hint">ⓘ ≈ 7 МБ на каждые 10 секунд (из выбранного битрейта).</p>
        )}
      </section>

      {/* ACTIONS */}
      <div className="actions">
        <Button variant="primary" onClick={record}>
          {isFirefox ? '● Открыть окно записи' : '● Записать'}
        </Button>
        <Button onClick={onScreenshot}>⛶ Скриншот</Button>
      </div>
      {isFirefox && (
        <p className="hint">
          ⓘ Запись начнётся в отдельном окне — здесь она бы оборвалась.
        </p>
      )}
      <p className="shortcuts mono">Alt+Shift+R · Alt+Shift+A</p>

      <button type="button" className="library-link" onClick={openStudio}>
        Библиотека: {MOCK_LIBRARY.length} записей · {formatBytes(MOCK_LIBRARY_BYTES)} →
      </button>
    </>
  );

  function onScreenshot() {
    void browser.runtime.sendMessage({ type: 'capture:screenshot' }).catch(() => undefined);
  }
}

function RecordingPanel({
  onStop,
  onShowWindow,
}: {
  onStop: () => void;
  onShowWindow: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const elapsed = useTicker(MOCK_SESSION.startedAt, !paused);

  return (
    <div className="rec-panel">
      <MockBadge note="Демо-сессия записи · таймер настоящий, захват замокан (scaffold)." />
      <div className="rec-status" role="status" aria-live="polite">
        <span className={paused ? 'rec-label rec-label--paused' : 'rec-label'}>
          {paused ? '❚❚ ПАУЗА' : '● ЗАПИСЬ'}
        </span>
        {/* The ticking timer is aria-hidden so a screen reader isn't spammed
            every second (design §11.2); state changes are announced via the
            role="status" wrapper text above. */}
        <span className="rec-timer mono" aria-hidden="true">
          {formatDuration(elapsed)}
        </span>
      </div>
      <p className="rec-meta mono">{MOCK_SESSION.host}</p>
      <p className="rec-meta mono">{formatBytes(MOCK_SESSION.bytesOnDisk)}</p>

      <div className="actions">
        <Button onClick={() => setPaused((p) => !p)}>
          {paused ? '▶ Продолжить' : '❚❚ Пауза'}
        </Button>
        <Button variant="primary" onClick={onStop}>
          ■ Стоп
        </Button>
      </div>
      <button type="button" className="library-link" onClick={onShowWindow}>
        Показать окно записи
      </button>
    </div>
  );
}
