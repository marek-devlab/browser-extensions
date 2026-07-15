import { useCallback, useEffect, useRef, useState } from 'react';
import { browser, storage } from '#imports';
import { Button, Callout } from '@blur/ui';
import { formatBytes, formatDuration } from '../../utils/format';
import { getLive, isStale, watchLive } from '../../utils/live-state';
import { openDisplayStream } from '../../utils/media';
import { isMessage, send, type Message, type Reply, type StartOptions } from '../../utils/messages';
import { LOW_DISK_BYTES, MIC_CHANNEL, RecordingSession } from '../../utils/session';
import { elapsedMs, type LiveState } from '../../utils/types';

// RECORDER WINDOW — a real OS window (windows.create({type:'popup'})), NOT an
// extension popup (design capture.md §1.1, §2.3). It survives focus loss, floats
// above any tab, and its TITLE carries the live timer into the OS taskbar and
// Alt-Tab — a clock visible without even looking at the browser, and one that
// costs nothing: it ticks inside this document, so the service worker sleeps on.
//
// 🔴 There is no on-page overlay and never will be: tabCapture records the tab
// COMPOSITE, so an injected Stop button would be BAKED INTO THE VIDEO (§1.4).
// This window, the badge and the global shortcut are the three channels.
//
// The asymmetry that defines this file:
//   CHROME  — a thin REMOTE. The offscreen document owns the stream. Closing this
//             window is harmless; the recording continues.
//   FIREFOX — this window IS the recorder. It calls getDisplayMedia (which needs
//             transient activation → the big "Начать запись" button below, plus
//             Firefox's own source picker), owns the MediaStream, and closing it
//             STOPS the recording. Both facts are written into the window itself.

const isFirefox = import.meta.env.FIREFOX;

const pendingItem = storage.defineItem<StartOptions | null>('session:pending', {
  fallback: null,
});

export function App() {
  const [live, setLive] = useState<LiveState | null>(null);
  const [pending, setPending] = useState<StartOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [level, setLevel] = useState(0);
  const [, setNow] = useState(Date.now());
  const [starting, setStarting] = useState(false);
  const sessionRef = useRef<RecordingSession | null>(null);

  // The clock — inside THIS document, so it never wakes the service worker
  // (design §1.3). Elapsed time is recomputed from wall-clock each tick rather
  // than incremented, so throttling cannot make it drift.
  useEffect(() => {
    const id = globalThis.setInterval(() => setNow(Date.now()), 500);
    return () => globalThis.clearInterval(id);
  }, []);

  useEffect(() => {
    void getLive().then(setLive);
    return watchLive(setLive);
  }, []);

  useEffect(() => {
    if (!isFirefox) return;
    void pendingItem.getValue().then(setPending);
  }, []);

  // Mic level, pushed by whoever owns the stream, over a same-origin
  // BroadcastChannel. Deliberately NOT runtime.sendMessage: that would wake the
  // service worker eight times a second for a decorative bar (utils/session.ts).
  useEffect(() => {
    const ch = new BroadcastChannel(MIC_CHANNEL);
    ch.onmessage = (e: MessageEvent<{ level?: number }>) => {
      if (typeof e.data?.level === 'number') setLevel(e.data.level);
    };
    return () => ch.close();
  }, []);

  const elapsed = live ? elapsedMs(live) : 0;
  const paused = live?.status === 'paused';
  const stale = isStale(live);
  const recording = !!live && !stale && (live.status === 'recording' || live.status === 'paused');

  // The title-bar clock (design §1.3): the OS shows it in the taskbar / Alt-Tab,
  // so the timer stays visible even when this window is behind everything else.
  useEffect(() => {
    if (!recording) {
      document.title = 'Capture Studio';
      return;
    }
    const mark = paused ? '❚❚' : '●';
    const state = paused ? 'пауза' : 'запись';
    document.title = `${mark} ${formatDuration(elapsed)} — ${state} · Capture Studio`;
  }, [elapsed, paused, recording]);

  // FIREFOX ONLY: this window owns the stream, so closing it ends the recording.
  // Warn — and note that whatever is already recorded is safe regardless, because
  // it has been going to IndexedDB in 3-second chunks all along (§2.4, §10.6).
  useEffect(() => {
    if (!isFirefox) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!sessionRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onPageHide = () => void sessionRef.current?.stop('source-ended');
    globalThis.addEventListener('beforeunload', onBeforeUnload);
    globalThis.addEventListener('pagehide', onPageHide);
    return () => {
      globalThis.removeEventListener('beforeunload', onBeforeUnload);
      globalThis.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // FIREFOX ONLY: the recorder:* commands are handled HERE, because this is where
  // the MediaRecorder physically lives.
  useEffect(() => {
    if (!isFirefox) return;
    const listener = (raw: unknown, _s: unknown, respond: (r: Reply) => void) => {
      if (!isMessage(raw)) return false;
      const msg = raw as Message;
      if (!msg.type.startsWith('recorder:') || msg.type === 'recorder:focus') return false;
      void (async (): Promise<Reply> => {
        const s = sessionRef.current;
        if (!s) return { ok: false, error: 'Нет активной записи в этом окне.' };
        switch (msg.type) {
          case 'recorder:stop':
            await s.stop('user');
            sessionRef.current = null;
            return { ok: true };
          case 'recorder:pause':
            await s.pause();
            return { ok: true };
          case 'recorder:resume':
            await s.resume();
            return { ok: true };
          case 'recorder:cancel':
            await s.cancel();
            sessionRef.current = null;
            return { ok: true };
          case 'recorder:mute':
            s.setMuted(msg.muted);
            return { ok: true };
          default:
            return { ok: false, error: 'unknown' };
        }
      })().then(respond);
      return true;
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  /** FIREFOX: the second click. getDisplayMedia REQUIRES transient user
   *  activation and a background script has none — so there is no way to make
   *  this a single click. We explain it instead of pretending (§1.5, §4.4). */
  const startFirefox = useCallback(async () => {
    if (!pending || starting) return;
    setStarting(true);
    setError(null);
    try {
      const stream = await openDisplayStream(pending);
      // The recorded surface's own label — the window/screen title Firefox's
      // picker returned. It's the only honest identifier we have here (there is no
      // tab URL to hostname-ify: the user picked an arbitrary surface, possibly a
      // non-browser window). If Firefox gives us nothing, stay generic rather than
      // invent a host (an interrupted clip then reads "Запись экрана", not a lie).
      const label = stream.getVideoTracks()[0]?.label?.trim() ?? '';
      const s = new RecordingSession({
        sessionId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        owner: 'recorder',
        stream,
        options: pending,
        source: pending.source,
        host: label,
        tabId: null,
      });
      await s.begin();
      sessionRef.current = s;
      await pendingItem.setValue(null);
      setPending(null);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'Вы отменили выбор источника. Ничего не записано.'
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setStarting(false);
    }
  }, [pending, starting]);

  // ── Firefox: the pre-start screen (the extra, unavoidable click) ───────────
  if (isFirefox && !recording) {
    return (
      <div className="recorder">
        <h1 className="rec-title">Capture Studio</h1>
        {error && (
          <Callout tone="warn" title="Запись не началась">
            {error}
          </Callout>
        )}
        {pending ? (
          <>
            <Button variant="primary" onClick={() => void startFirefox()} disabled={starting}>
              {starting ? 'Открываем…' : '● Начать запись'}
            </Button>
            <p className="note">
              Firefox сам спросит, что записывать, — своим диалогом. Это его требование
              безопасности: доступ к экрану выдаётся только по клику на странице, и мы не
              можем сделать это за вас.
            </p>
            <Callout tone="warn">
              <strong>Звук вкладки Firefox записать не может.</strong> Его{' '}
              <code>getDisplayMedia</code> не отдаёт аудиодорожку вообще — это отсутствующая
              возможность браузера, а не наша настройка. Доступен только микрофон.
            </Callout>
          </>
        ) : (
          <p className="note">
            Нет запроса на запись. Откройте popup расширения и нажмите «Открыть окно записи».
          </p>
        )}
      </div>
    );
  }

  // ── No live session (a Chrome remote opened with nothing running) ──────────
  if (!live || stale) {
    return (
      <div className="recorder">
        <h1 className="rec-title">Capture Studio</h1>
        {stale ? (
          <Callout tone="warn" title="Запись прервалась">
            Процесс, который вёл запись, перестал отвечать. Записанное до последнего сброса
            (потеряно не более ~3 секунд) лежит на диске — откройте Библиотеку и
            восстановите.
          </Callout>
        ) : (
          <p className="note">Сейчас ничего не записывается.</p>
        )}
        <Button onClick={() => void openStudio()}>Открыть библиотеку</Button>
      </div>
    );
  }

  const lowDisk = live.freeBytes != null && live.freeBytes < LOW_DISK_BYTES;

  return (
    <div className="recorder">
      <div className="rec-head">
        {/* Never colour alone: the red dot always comes with the WORD (§11.2). */}
        <span className={paused ? 'rec-word rec-word--paused' : 'rec-word'}>
          {paused ? '❚❚ ПАУЗА' : '● ЗАПИСЬ'}
        </span>
        {/* aria-hidden: a screen reader must not read the seconds forever (§11.2). */}
        <span className="rec-time mono" aria-hidden="true">
          {formatDuration(elapsed)}
        </span>
      </div>
      {/* Only STATE CHANGES are announced (design §11.2). */}
      <div className="sr-only" role="status" aria-live="polite">
        {paused ? 'Запись на паузе' : 'Идёт запись'}
      </div>

      <hr />

      <p className="src mono">
        {live.source === 'screen'
          ? 'Источник: экран или окно'
          : live.host
            ? `Вкладка: ${live.host}`
            : 'Источник: выбран в диалоге браузера'}
      </p>
      <p className="specs mono">
        {live.width}×{live.height} · {live.fps} к/с · {live.format.toUpperCase()}
        {isFirefox ? ' · без звука вкладки' : ''}
      </p>

      {live.mic ? (
        <div className="mic-row">
          <span aria-hidden="true">🎤</span>
          <span className="mic-meter" aria-hidden="true">
            <span
              className="mic-fill"
              style={{ width: `${Math.round((live.micMuted ? 0 : level) * 100)}%` }}
            />
          </span>
          <button
            type="button"
            className="mini-btn"
            onClick={() => void send({ type: 'capture:mute', muted: !live.micMuted })}
          >
            {live.micMuted ? 'Включить микрофон' : 'Мьют'}
          </button>
        </div>
      ) : (
        <p className="mono muted">🎤 Микрофон выключен</p>
      )}

      <p className="disk mono">
        💾 {formatBytes(live.bytesOnDisk)} записано
        {live.freeBytes != null && <> · свободно ≈ {formatBytes(live.freeBytes)}</>}
      </p>
      {lowDisk && (
        <Callout tone="warn">
          Место заканчивается. Когда оно кончится, запись остановится сама и записанное
          сохранится — но лучше остановить заранее.
        </Callout>
      )}

      <div className="controls">
        <button
          type="button"
          className="ctl"
          onClick={() => void send({ type: paused ? 'capture:resume' : 'capture:pause' })}
        >
          {paused ? '▶ Продолжить' : '❚❚ Пауза'}
        </button>
        <button
          type="button"
          className="ctl ctl--stop"
          onClick={() => void send({ type: 'capture:stop' })}
        >
          ■ Стоп
        </button>
        <button
          type="button"
          className={cancelArmed ? 'ctl ctl--danger' : 'ctl'}
          onClick={() => {
            // Two-step, like every destructive action in this family: throwing
            // away four minutes of work must never be one careless click.
            if (!cancelArmed) setCancelArmed(true);
            else void send({ type: 'capture:cancel' });
          }}
          onBlur={() => setCancelArmed(false)}
        >
          {cancelArmed ? `Точно удалить ${formatDuration(elapsed)}?` : '✕ Отменить'}
        </button>
      </div>
      <p className="keys mono">Alt+Shift+P · Alt+Shift+S</p>

      {isFirefox ? (
        <Callout tone="warn">
          <strong>Не закрывайте это окно</strong> — запись живёт здесь. Если закрыть, она
          остановится, но записанное сохранится. Firefox также показывает свой индикатор «вы
          делитесь экраном»; его «Прекратить» — тоже штатный «Стоп», а не ошибка.
        </Callout>
      ) : (
        <p className="note">
          Это окно можно закрыть — запись продолжится (она живёт в невидимом
          offscreen-документе). Остановить: Alt+Shift+S или клик по иконке расширения.
        </p>
      )}
      <p className="note muted">
        Не сворачивайте записываемую вкладку — перекрытую вкладку браузер может
        отрисовывать реже, и в записи это будет видно.
      </p>
    </div>
  );
}

function openStudio() {
  return browser.tabs
    .create({ url: browser.runtime.getURL('/editor.html') })
    .catch(() => undefined);
}
