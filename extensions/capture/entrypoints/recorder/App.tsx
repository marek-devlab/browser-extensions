import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { MockBadge } from '@blur/ui';
import { formatBytes, formatDuration } from '../../utils/format';
import { MOCK_SESSION, MOCK_FREE_BYTES } from '../../utils/mock-data';
import { useTicker } from '../../utils/use-ticker';

// Recorder window — a SEPARATE OS WINDOW (windows.create({type:'popup'})), NOT an
// extension popup (design capture.md §1.1, §2.3). It survives focus loss, floats
// over any tab, and puts the timer in its title bar. On CHROME it is a thin remote
// over the offscreen doc ("this window can be closed — recording continues"); on
// FIREFOX it OWNS the MediaStream ("do NOT close this window — recording lives
// here"). That asymmetry is written into the window itself (design §1.2, §2.4).
//
// REAL here: the 1 Hz timer, the document.title clock, pause/stop/two-step cancel,
// and the per-browser copy. MOCKED: the stream, the mic level, byte accrual.

const isFirefox = import.meta.env.FIREFOX;

export function App() {
  const [paused, setPaused] = useState(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [muted, setMuted] = useState(false);
  const elapsed = useTicker(MOCK_SESSION.startedAt, !paused);

  // The title-bar clock (design §1.3): updated inside THIS document, so it never
  // wakes the service worker. The OS shows it in the taskbar / Alt-Tab.
  useEffect(() => {
    const mark = paused ? '❚❚' : '●';
    const state = paused ? 'пауза' : 'запись';
    document.title = `${mark} ${formatDuration(elapsed)} — ${state} · Capture Studio`;
  }, [elapsed, paused]);

  // Firefox: closing this window STOPS the recording (the window owns the stream),
  // so guard the close (design §2.4, §10.6). Chrome omits this — closing the
  // remote is harmless.
  useEffect(() => {
    if (!isFirefox) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    globalThis.addEventListener('beforeunload', onBeforeUnload);
    return () => globalThis.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  function stop() {
    void browser.runtime.sendMessage({ type: 'capture:stop' }).catch(() => undefined);
    // Real impl closes this window after finalisation; scaffold leaves it.
  }
  function cancel() {
    if (!cancelArmed) {
      setCancelArmed(true);
      return;
    }
    void browser.runtime.sendMessage({ type: 'capture:cancel' }).catch(() => undefined);
  }

  return (
    <div className="recorder">
      <MockBadge note="Демо-пульт · таймер и заголовок окна настоящие, поток замокан." />

      <div className="rec-head">
        <span className={paused ? 'rec-word rec-word--paused' : 'rec-word'}>
          {paused ? '❚❚ ПАУЗА' : '● ЗАПИСЬ'}
        </span>
        {/* aria-hidden: don't let a screen reader read every second (design §11.2). */}
        <span className="rec-time mono" aria-hidden="true">
          {formatDuration(elapsed)}
        </span>
      </div>
      {/* State-change announcements only (design §11.2). */}
      <div className="sr-only" role="status" aria-live="polite">
        {paused ? 'Запись на паузе' : 'Идёт запись'}
      </div>

      <hr />

      <p className="src mono">
        {isFirefox
          ? 'Источник: вкладка «Dashboard» (выбрана вами в диалоге Firefox)'
          : `Вкладка: ${MOCK_SESSION.host}`}
      </p>
      <p className="specs mono">
        {isFirefox
          ? '⚠ Без звука вкладки — Firefox его не даёт'
          : `${MOCK_SESSION.resolution.width}×${MOCK_SESSION.resolution.height} · ${MOCK_SESSION.fps} к/с · ${MOCK_SESSION.format.toUpperCase()}`}
      </p>

      <div className="mic-row">
        <span aria-hidden="true">🎤</span>
        <span className="mic-meter" aria-hidden="true">
          {muted ? '— — — — —' : '▇▇▇▅▂▁ ▁▁'}
        </span>
        <button type="button" className="mini-btn" onClick={() => setMuted((m) => !m)}>
          {muted ? 'Вкл. микрофон' : 'Мьют'}
        </button>
      </div>

      <p className="disk mono">
        💾 {formatBytes(MOCK_SESSION.bytesOnDisk)} записано
        {!isFirefox && <> · свободно ≈ {formatBytes(MOCK_FREE_BYTES)}</>}
      </p>

      <div className="controls">
        <button type="button" className="ctl" onClick={() => setPaused((p) => !p)}>
          {paused ? '▶ Продолжить' : '❚❚ Пауза'}
        </button>
        <button type="button" className="ctl ctl--stop" onClick={stop}>
          ■ Стоп
        </button>
        <button
          type="button"
          className={cancelArmed ? 'ctl ctl--danger' : 'ctl'}
          onClick={cancel}
          onBlur={() => setCancelArmed(false)}
        >
          {cancelArmed ? `Точно удалить ${formatDuration(elapsed)}?` : '✕ Отменить'}
        </button>
      </div>
      <p className="keys mono">Alt+Shift+P · Alt+Shift+S</p>

      {isFirefox ? (
        <div className="note note--warn" role="note">
          ⚠ Не закрывайте это окно. Запись живёт здесь. Если закрыть — она
          остановится, но записанное сохранится. Firefox также показывает свой
          индикатор «вы делитесь экраном» — его «Прекратить» тоже останавливает
          запись (это штатный «Стоп», не ошибка).
        </div>
      ) : (
        <p className="note">
          Это окно можно закрыть — запись продолжится. Остановить: Alt+Shift+S или
          клик по иконке расширения.
        </p>
      )}
    </div>
  );
}
