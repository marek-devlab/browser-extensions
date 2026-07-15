import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { Button, Callout } from '@blur/ui';
import { listClips } from '../../utils/db';
import { formatBytes, formatDuration } from '../../utils/format';
import { getLive, isStale, watchLive } from '../../utils/live-state';
import { SHOT_COOLDOWN_MS } from '../../utils/media';
import { send, type Reply, type StartOptions } from '../../utils/messages';
import { capabilities, NO_RECORDING_TITLE } from '../../utils/platform';
import { usePrefs } from '../../utils/use-prefs';
import { elapsedMs, type LiveState } from '../../utils/types';

// POPUP — the 320px REMOTE, not the studio (design capture.md §1.1, §2.1).
//
// Clicking the toolbar icon is the ONE gesture that yields `activeTab` and lets
// tabCapture attach to the current tab without <all_urls>. So this is where a
// recording STARTS — but nothing about a recording may LIVE here: the popup dies
// the moment focus moves, and a stream it owned would die with it (§1.1).
//
// Two states, and only two:
//   idle       → the setup form + Record / Screenshot;
//   recording  → the fallback remote (§2.5). Clicking the icon mid-recording must
//                NEVER show the setup form again — offering "Record" on top of a
//                live recording is the classic bug of the genre.

const isFirefox = import.meta.env.FIREFOX;
const caps = capabilities();

export function App() {
  const [live, setLive] = useState<LiveState | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    void getLive().then(setLive);
    return watchLive(setLive);
  }, []);
  useEffect(() => {
    const id = globalThis.setInterval(() => tick((n) => n + 1), 1000);
    return () => globalThis.clearInterval(id);
  }, []);

  const active = !!live && !isStale(live);

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
          onClick={() => void openStudio('#/settings')}
        >
          ⚙
        </button>
      </header>

      {active && live ? (
        <RecordingPanel live={live} />
      ) : (
        <SetupForm stale={!!live && isStale(live)} />
      )}
    </div>
  );
}

function openStudio(hash = '') {
  return browser.tabs
    .create({ url: browser.runtime.getURL('/editor.html') + hash })
    .catch(() => undefined);
}

/** Has the user already granted the microphone to this extension's ORIGIN?
 *  ⚠️ The offscreen document cannot ask — it has no UI (design §5.9) — so the
 *  grant has to come from a visible page. This popup is one. */
async function micGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({
      name: 'microphone' as PermissionName,
    });
    if (status) return status.state === 'granted';
  } catch {
    /* Firefox does not implement the `microphone` permission query */
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    // Device labels are only revealed once a grant exists — the classic probe.
    return devices.some((d) => d.kind === 'audioinput' && d.label !== '');
  } catch {
    return false;
  }
}

function SetupForm({ stale }: { stale: boolean }) {
  const { prefs, update } = usePrefs();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shotCooling, setShotCooling] = useState(false);
  const [needMicGrant, setNeedMicGrant] = useState(false);
  const [lib, setLib] = useState<{ n: number; bytes: number } | null>(null);

  useEffect(() => {
    void listClips()
      .then((clips) =>
        setLib({ n: clips.length, bytes: clips.reduce((s, c) => s + c.sizeBytes, 0) }),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!prefs.mic) {
      setNeedMicGrant(false);
      return;
    }
    void micGranted().then((g) => setNeedMicGrant(!g));
  }, [prefs.mic]);

  async function record() {
    setBusy(true);
    setError(null);
    const options: StartOptions = {
      source: prefs.source,
      // Firefox: not a choice of ours — getDisplayMedia has no audio track at all.
      tabAudio: caps.canRecordTabAudio ? prefs.tabAudio : false,
      mic: prefs.mic,
      micDeviceId: prefs.micDeviceId,
      format: caps.canRecordMp4 ? prefs.defaultVideoFormat : 'webm',
      fps: prefs.defaultFps,
      maxHeight: prefs.defaultResolution?.height ?? null,
      quality: prefs.defaultQuality,
    };
    const reply = await send<Reply>({ type: 'capture:start', options });
    setBusy(false);
    if (!reply) {
      setError('Фоновый скрипт не ответил. Попробуйте ещё раз.');
      return;
    }
    if (!reply.ok) {
      setError(reply.error);
      return;
    }
    // Chrome: the stream is already live in the offscreen document, so the popup
    // may close freely. Firefox: the recorder window is open, waiting for the
    // second (unavoidable) click.
    globalThis.close();
  }

  async function screenshot() {
    setShotCooling(true);
    const reply = await send<Reply>({ type: 'capture:screenshot' });
    // The platform's 2/sec limit is enforced honestly: the button greys out for
    // 550 ms instead of the click being silently swallowed (design §5.14).
    globalThis.setTimeout(() => setShotCooling(false), SHOT_COOLDOWN_MS);
    if (reply && !reply.ok) setError(reply.error);
    else globalThis.close();
  }

  async function grantMic() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setNeedMicGrant(false);
    } catch {
      setError('Микрофон не разрешён. Запись пойдёт без него — молча этого не сделаем.');
    }
  }

  // 🔴 A platform that cannot record says so plainly, and keeps what DOES work.
  // Never a dead button, never a spinner that resolves to nothing (§8, PLAN-2 §1.5).
  if (!caps.canRecord) {
    return (
      <>
        <Callout tone="warn" title={NO_RECORDING_TITLE}>
          {caps.reason}
          <br />
          Запись экрана в мобильных браузерах невозможна в принципе: там нет ни{' '}
          <code>tabCapture</code>, ни <code>getDisplayMedia</code>. Мы этого не обещаем и не
          имитируем.
        </Callout>
        {caps.canScreenshot && (
          <>
            <p className="hint">Скриншоты работают — они не требуют захвата потока.</p>
            <div className="actions">
              <Button variant="primary" onClick={() => void screenshot()} disabled={shotCooling}>
                ⛶ Скриншот
              </Button>
            </div>
          </>
        )}
        {error && <Callout tone="warn">{error}</Callout>}
        <button type="button" className="library-link" onClick={() => void openStudio()}>
          Открыть библиотеку →
        </button>
      </>
    );
  }

  return (
    <>
      {stale && (
        <Callout tone="warn" title="Прошлая запись прервалась">
          Записанное сохранено на диске. Откройте библиотеку, чтобы восстановить.
        </Callout>
      )}
      {error && (
        <Callout tone="warn" title="Не удалось">
          {error}
        </Callout>
      )}

      <section>
        <h2>Источник</h2>
        {isFirefox ? (
          // Firefox degradation is shown by REMOVING the choice and EXPLAINING —
          // never a disabled radio, which reads as "I misconfigured something"
          // instead of "the browser cannot do this" (design §2.2, §8).
          <p className="hint">
            Firefox спросит сам, что записывать, — своим диалогом. Мы не можем выбрать за
            вас.
          </p>
        ) : (
          <div className="radio-list">
            <label className="radio">
              <input
                type="radio"
                name="source"
                checked={prefs.source === 'tab'}
                onChange={() => update({ source: 'tab' })}
              />
              <span>Эта вкладка</span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name="source"
                checked={prefs.source === 'screen'}
                onChange={() => update({ source: 'screen' })}
              />
              <span>
                Весь экран или окно…
                <em>ⓘ запросит доступ — по кнопке, не при установке</em>
              </span>
            </label>
          </div>
        )}
      </section>

      <section>
        <h2>Звук</h2>
        {caps.canRecordTabAudio ? (
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.tabAudio}
              onChange={(e) => update({ tabAudio: e.target.checked })}
            />
            Звук вкладки
          </label>
        ) : (
          <div className="callout callout--warn" role="note">
            <strong>⚠ Звук вкладки в Firefox записать невозможно.</strong> Это ограничение
            браузера (<code>getDisplayMedia</code> не отдаёт аудиодорожку), а не нашей
            настройки. Доступен только микрофон.
          </div>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.mic}
            onChange={(e) => update({ mic: e.target.checked })}
          />
          Микрофон
        </label>
        {prefs.mic && needMicGrant && (
          <div className="callout callout--info" role="note">
            Браузер ещё не выдал доступ к микрофону. Разрешение спрашивается только с{' '}
            <strong>видимой</strong> страницы — невидимый offscreen-документ этого не умеет.
            <button type="button" className="ui-btn ui-btn--sm" onClick={() => void grantMic()}>
              Разрешить микрофон
            </button>
          </div>
        )}
      </section>

      <section>
        <h2>Качество</h2>
        <div className="field">
          <label htmlFor="res">Разрешение</label>
          <select
            id="res"
            value={prefs.defaultResolution?.height ?? 0}
            onChange={(e) => {
              const h = Number(e.target.value);
              // Only DOWNSCALE is ever offered: upscaling is a lie about quality
              // (design §13).
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
        </div>
        <div className="field">
          <label htmlFor="fps">Частота</label>
          <select
            id="fps"
            value={prefs.defaultFps}
            onChange={(e) => update({ defaultFps: Number(e.target.value) })}
          >
            <option value={30}>30 к/с</option>
            <option value={25}>25 к/с</option>
            <option value={15}>15 к/с</option>
            <option value={60}>60 к/с</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="fmt">Формат</label>
          {caps.canRecordMp4 ? (
            <select
              id="fmt"
              value={prefs.defaultVideoFormat}
              onChange={(e) =>
                update({ defaultVideoFormat: e.target.value === 'mp4' ? 'mp4' : 'webm' })
              }
            >
              <option value="mp4">MP4 (H.264)</option>
              <option value="webm">WebM (VP9)</option>
            </select>
          ) : (
            <select id="fmt" value="webm" disabled>
              <option value="webm">WebM (VP9)</option>
            </select>
          )}
        </div>
        {!caps.canRecordMp4 && (
          <p className="hint">
            ⚠ Этот браузер пишет только WebM. MP4 получится на экспорте — это
            перекодирование, а не смена расширения.
          </p>
        )}
        <p className="hint">
          ⓘ Битрейт записи — только пожелание: браузер вправе его не послушаться. Точный
          размер задаётся на экспорте.
        </p>
      </section>

      <div className="actions">
        <Button variant="primary" onClick={() => void record()} disabled={busy}>
          {isFirefox ? '● Открыть окно записи' : '● Записать'}
        </Button>
        <Button onClick={() => void screenshot()} disabled={shotCooling}>
          {shotCooling ? '…' : '⛶ Скриншот'}
        </Button>
      </div>
      {isFirefox && (
        <p className="hint">
          ⓘ Запись начнётся в отдельном окне и потребует ещё одного клика — здесь она
          оборвалась бы вместе с popup.
        </p>
      )}
      <p className="shortcuts mono">Alt+Shift+R · Alt+Shift+A</p>

      <button type="button" className="library-link" onClick={() => void openStudio()}>
        {lib ? `Библиотека: ${lib.n} · ${formatBytes(lib.bytes)} →` : 'Библиотека →'}
      </button>
    </>
  );
}

/** The fallback remote (design §2.5). */
function RecordingPanel({ live }: { live: LiveState }) {
  const paused = live.status === 'paused';
  const elapsed = elapsedMs(live);

  return (
    <div className="rec-panel">
      <div className="rec-status" role="status" aria-live="polite">
        <span className={paused ? 'rec-label rec-label--paused' : 'rec-label'}>
          {paused ? '❚❚ ПАУЗА' : '● ЗАПИСЬ'}
        </span>
        <span className="rec-timer mono" aria-hidden="true">
          {formatDuration(elapsed)}
        </span>
      </div>
      <p className="rec-meta mono">{live.host || 'экран'}</p>
      <p className="rec-meta mono">{formatBytes(live.bytesOnDisk)} на диске</p>

      <div className="actions">
        <Button onClick={() => void send({ type: paused ? 'capture:resume' : 'capture:pause' })}>
          {paused ? '▶ Продолжить' : '❚❚ Пауза'}
        </Button>
        <Button variant="primary" onClick={() => void send({ type: 'capture:stop' })}>
          ■ Стоп
        </Button>
      </div>
      <button
        type="button"
        className="library-link"
        onClick={() => void send({ type: 'recorder:focus' })}
      >
        Показать окно записи
      </button>
    </div>
  );
}
