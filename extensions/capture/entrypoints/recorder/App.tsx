import { useCallback, useEffect, useRef, useState } from 'react';
import { browser, storage } from '#imports';
import { Button, Callout, useLocale } from '@blur/ui';
import { formatBytes, formatDuration } from '../../utils/format';
import { useT } from '../../utils/i18n';
import { getLive, isStale, watchLive } from '../../utils/live-state';
import { openDisplayStream } from '../../utils/media';
import { isMessage, send, type Message, type Reply, type StartOptions } from '../../utils/messages';
import { LOW_DISK_BYTES, MIC_CHANNEL, RecordingSession } from '../../utils/session';
import { CaptureLocaleProvider } from '../../utils/use-locale';
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
  return (
    <CaptureLocaleProvider>
      <RecorderApp />
    </CaptureLocaleProvider>
  );
}

function RecorderApp() {
  const t = useT();
  const locale = useLocale();
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
    const state = paused ? t('rec_title_paused') : t('rec_title_recording');
    document.title = `${mark} ${formatDuration(elapsed)} — ${state} · Capture Studio`;
  }, [elapsed, paused, recording, t]);

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
        if (!s) return { ok: false, error: 'No active recording in this window.' };
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
          ? t('rec_cancelled_source')
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setStarting(false);
    }
  }, [pending, starting, t]);

  // ── Firefox: the pre-start screen (the extra, unavoidable click) ───────────
  if (isFirefox && !recording) {
    return (
      <div className="recorder">
        <h1 className="rec-title">Capture Studio</h1>
        {error && (
          <Callout tone="warn" title={t('rec_not_started_title')}>
            {error}
          </Callout>
        )}
        {pending ? (
          <>
            <Button variant="primary" onClick={() => void startFirefox()} disabled={starting}>
              {starting ? t('rec_opening') : t('rec_start_btn')}
            </Button>
            <p className="note">{t('rec_ff_note')}</p>
            <Callout tone="warn">
              <strong>{t('rec_ff_audio_strong')}</strong>
              {t('rec_ff_audio_1')}
              <code>getDisplayMedia</code>
              {t('rec_ff_audio_2')}
            </Callout>
          </>
        ) : (
          <p className="note">{t('rec_no_request')}</p>
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
          <Callout tone="warn" title={t('rec_interrupted_title')}>
            {t('rec_interrupted_body')}
          </Callout>
        ) : (
          <p className="note">{t('rec_nothing')}</p>
        )}
        <Button onClick={() => void openStudio()}>{t('rec_open_library')}</Button>
      </div>
    );
  }

  const lowDisk = live.freeBytes != null && live.freeBytes < LOW_DISK_BYTES;

  return (
    <div className="recorder">
      <div className="rec-head">
        {/* Never colour alone: the red dot always comes with the WORD (§11.2). */}
        <span className={paused ? 'rec-word rec-word--paused' : 'rec-word'}>
          {paused ? t('rec_paused_word') : t('rec_recording_word')}
        </span>
        {/* aria-hidden: a screen reader must not read the seconds forever (§11.2). */}
        <span className="rec-time mono" aria-hidden="true">
          {formatDuration(elapsed)}
        </span>
      </div>
      {/* Only STATE CHANGES are announced (design §11.2). */}
      <div className="sr-only" role="status" aria-live="polite">
        {paused ? t('rec_sr_paused') : t('rec_sr_recording')}
      </div>

      <hr />

      <p className="src mono">
        {live.source === 'screen'
          ? t('rec_source_screen')
          : live.host
            ? t('rec_source_tab', { host: live.host })
            : t('rec_source_dialog')}
      </p>
      <p className="specs mono">
        {live.width}×{live.height} · {t('fps_value', { n: live.fps })} · {live.format.toUpperCase()}
        {isFirefox ? t('rec_specs_no_tab_audio') : ''}
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
            {live.micMuted ? t('rec_mic_unmute') : t('rec_mic_mute')}
          </button>
        </div>
      ) : (
        <p className="mono muted">{t('rec_mic_off')}</p>
      )}

      <p className="disk mono">
        {t('rec_recorded', { size: formatBytes(live.bytesOnDisk, locale) })}
        {live.freeBytes != null && t('rec_free', { size: formatBytes(live.freeBytes, locale) })}
      </p>
      {lowDisk && <Callout tone="warn">{t('rec_low_disk')}</Callout>}

      <div className="controls">
        <button
          type="button"
          className="ctl"
          onClick={() => void send({ type: paused ? 'capture:resume' : 'capture:pause' })}
        >
          {paused ? t('pop_resume') : t('pop_pause')}
        </button>
        <button
          type="button"
          className="ctl ctl--stop"
          onClick={() => void send({ type: 'capture:stop' })}
        >
          {t('pop_stop')}
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
          {cancelArmed ? t('rec_cancel_confirm', { dur: formatDuration(elapsed) }) : t('rec_cancel')}
        </button>
      </div>
      <p className="keys mono">Alt+Shift+P · Alt+Shift+S</p>

      {isFirefox ? (
        <Callout tone="warn">
          <strong>{t('rec_ff_dont_close_strong')}</strong>
          {t('rec_ff_dont_close_body')}
        </Callout>
      ) : (
        <p className="note">{t('rec_chrome_note')}</p>
      )}
      <p className="note muted">{t('rec_dont_minimize')}</p>
    </div>
  );
}

function openStudio() {
  return browser.tabs
    .create({ url: browser.runtime.getURL('/editor.html') })
    .catch(() => undefined);
}
