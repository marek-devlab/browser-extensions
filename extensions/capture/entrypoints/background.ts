import { defineBackground, browser, storage } from '#imports';
import { findInterruptedSessions, markOrphansInterrupted, putBlob, putClip } from '../utils/db';
import { getLive, isActive, isStale, liveItem, setLive, STALE_MS } from '../utils/live-state';
import { captureScreenshot, getDesktopStreamId, getTabStreamId } from '../utils/media';
import { isMessage, type Message, type Reply, type StartOptions } from '../utils/messages';
import { capabilities } from '../utils/platform';
import { prefsItem } from '../utils/storage';
import type { LiveState } from '../utils/types';

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND — service worker (Chrome) / event page (Firefox).
//
// 🔴 IT OWNS NOTHING ABOUT THE RECORDING. No stream, no MediaRecorder, no chunk
// buffer, no timer (design §1.2, §10.1). It is evicted at ~30 s idle and the
// recording must not notice. What it does own:
//   • the BADGE — and even that is DERIVED, not decided: it mirrors the live
//     record in storage.session that the actual recorder writes. The badge
//     therefore cannot claim a state the recorder is not in;
//   • the `commands` shortcuts — the PRIMARY Stop, reachable from any window,
//     any tab, a fullscreen video, or another application entirely (design §1.3
//     ②). An on-page overlay could never reach those places — and would be baked
//     into the video anyway, because tabCapture records the tab COMPOSITE (§1.4);
//   • the Chrome start sequence (streamId → offscreen → window), whose ORDER is
//     load-bearing: the streamId expires within seconds (design §1.5);
//   • screenshots (captureVisibleTab needs no DOM);
//   • rehydration after its own death.

const isFirefox = import.meta.env.FIREFOX;

/** Firefox: the recorder window must know what to record. It — not the
 *  background — is the context that can raise getDisplayMedia, so the options
 *  travel through session storage rather than a message the not-yet-loaded window
 *  would miss. */
const pendingItem = storage.defineItem<StartOptions | null>('session:pending', {
  fallback: null,
});

/** Ids of the surfaces WE opened. Kept in session storage (not SW memory — it
 *  dies) so we never open a second recorder window or a second Studio tab. */
const recorderWinItem = storage.defineItem<number | null>('session:recorderWindowId', {
  fallback: null,
});
const studioTabItem = storage.defineItem<number | null>('session:studioTabId', {
  fallback: null,
});

type BadgeState = 'idle' | 'recording' | 'paused' | 'processing' | 'error';

export default defineBackground({
  main() {
    const caps = capabilities();

    // ── BADGE ────────────────────────────────────────────────────────────────
    // State only — NEVER a per-second timer. `04:12` does not fit in ~4 glyphs,
    // and ticking it would wake the service worker every second: battery burn and
    // a lifecycle profile that looks like malware, in exchange for a number the
    // user can already read in the recorder window's title bar (design §1.3).
    // So the badge is written on state TRANSITIONS only.
    async function setBadge(state: BadgeState): Promise<void> {
      const map: Record<BadgeState, { text: string; color: string }> = {
        idle: { text: '', color: '#00000000' },
        recording: { text: 'REC', color: '#c5221f' },
        paused: { text: '❚❚', color: '#e37400' },
        processing: { text: '…', color: '#1a73e8' },
        error: { text: '!', color: '#c5221f' },
      };
      const { text, color } = map[state];
      const action = browser.action ?? browser.browserAction;
      try {
        await action?.setBadgeText({ text });
        await action?.setBadgeBackgroundColor({ color });
      } catch {
        // The action API can be briefly unavailable during teardown. The badge is
        // advisory; the live record is the truth.
      }
    }

    function badgeFor(live: LiveState | null): BadgeState {
      if (!live) return 'idle';
      if (live.status === 'error' || live.status === 'interrupted') return 'error';
      // A stale heartbeat means the owner died. Continuing to show REC would be
      // precisely the lie this architecture exists to prevent (design §5.11, §8).
      if (isStale(live)) return 'error';
      if (live.status === 'paused') return 'paused';
      // Only `stopping` maps to the `…` badge. Re-encoding runs in the Studio tab
      // and never writes `status: 'encoding'` to the live record, so mapping it
      // here would be a branch that can never fire — a badge state the recorder is
      // never in. One source of truth means only states the owner actually sets.
      if (live.status === 'stopping') return 'processing';
      return 'recording';
    }

    // The badge is a pure function of the live record, and the live record is
    // written by whoever actually holds the MediaRecorder. One source of truth.
    //
    // ⚠️ THE ONE WAY THE BADGE COULD STILL LIE, and how it is closed. The owner
    // heartbeats every 2 s, and each beat is a storage write → this listener →
    // badge. If the owner is OOM-killed, the beats simply STOP: no event, no
    // listener call, and a `REC` badge over a recording that no longer exists.
    //   • If the service worker is asleep, the next thing that wakes it re-runs
    //     main() → rehydrate() → the lie is corrected before the user sees a
    //     single frame of UI.
    //   • If the service worker is AWAKE, nothing would wake it — so after every
    //     live update we arm a single timeout for just past the staleness window.
    //     If a fresh beat arrives, the timeout is replaced; if none does, it fires
    //     and re-derives the badge from a now-stale record → `!`.
    // No recurring timer, nothing running while idle.
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    liveItem.watch((live) => {
      void setBadge(badgeFor(live ?? null));
      if (staleTimer) clearTimeout(staleTimer);
      if (live && !isStale(live)) {
        staleTimer = globalThis.setTimeout(() => {
          void (async () => {
            const cur = await getLive();
            if (cur && isStale(cur)) {
              await markOrphansInterrupted();
              await setLive(null);
              await setBadge('error');
            }
          })();
        }, STALE_MS + 1500);
      }
    });

    // ── REHYDRATE (design §10.1) ─────────────────────────────────────────────
    // The SW was evicted and some event has just resurrected it. It knows nothing.
    // Rebuild from (a) does the owner context still exist, and (b) what does the
    // live record say. If the record claims a recording that nobody owns, that
    // recording is over: mark the session interrupted so the library offers
    // RECOVERY, and stop the badge from lying about it.
    async function rehydrate(): Promise<void> {
      const live = await getLive();

      if (!live) {
        // No live record, but an open manifest on disk ⇒ the browser died mid
        // recording. The chunks are still there (design §5.11, §10.5).
        const orphans = await findInterruptedSessions();
        if (orphans.length) await markOrphansInterrupted();
        await setBadge(orphans.length ? 'error' : 'idle');
        return;
      }

      const ownerAlive =
        live.owner === 'offscreen' ? await hasOffscreen() : await hasRecorderWindow();

      if (!ownerAlive || isStale(live)) {
        await markOrphansInterrupted();
        await setLive(null);
        await setBadge('error');
        return;
      }
      await setBadge(badgeFor(live));
    }
    void rehydrate();
    browser.runtime.onStartup?.addListener(() => void rehydrate());
    browser.runtime.onInstalled.addListener(() => void rehydrate());

    // ── COMMANDS — the primary Stop (design §1.3 ②, §11.1) ───────────────────
    browser.commands?.onCommand.addListener((command) => {
      void (async () => {
        switch (command) {
          case 'start-recording': {
            const live = await getLive();
            if (isActive(live)) await stop();
            else await start(await defaultOptions());
            break;
          }
          case 'stop-recording':
            await stop();
            break;
          case 'toggle-pause':
            await togglePause();
            break;
          case 'screenshot':
            await screenshot();
            break;
        }
      })();
    });

    // ── MESSAGES ─────────────────────────────────────────────────────────────
    browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
      if (!isMessage(raw)) return false;
      const msg = raw as Message;
      // Only our own prefixes. `mic:level` and the offscreen/recorder-directed
      // messages belong to other listeners; answering them here would hijack the
      // reply, since only one listener may respond to a sendMessage.
      if (
        !msg.type.startsWith('capture:') &&
        msg.type !== 'recorder:focus' &&
        msg.type !== 'session:finished'
      ) {
        return false;
      }

      void (async (): Promise<Reply> => {
        try {
          switch (msg.type) {
            case 'capture:start':
              return await start(msg.options);
            case 'capture:stop':
              return await stop();
            case 'capture:pause':
              return await relay({ type: 'offscreen:pause' }, { type: 'recorder:pause' });
            case 'capture:resume':
              return await relay({ type: 'offscreen:resume' }, { type: 'recorder:resume' });
            case 'capture:cancel':
              return await relay({ type: 'offscreen:cancel' }, { type: 'recorder:cancel' });
            case 'capture:mute':
              return await relay(
                { type: 'offscreen:mute', muted: msg.muted },
                { type: 'recorder:mute', muted: msg.muted },
              );
            case 'capture:screenshot':
              return await screenshot();
            case 'recorder:focus':
              await focusRecorderWindow();
              return { ok: true };
            case 'session:finished':
              await onSessionFinished(msg.ok, msg.reason);
              return { ok: true };
            default:
              return { ok: false, error: 'unknown message' };
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          await setBadge('error');
          return { ok: false, error };
        }
      })().then(sendResponse);
      return true; // async reply
    });

    // ── START ────────────────────────────────────────────────────────────────
    async function start(options: StartOptions): Promise<Reply> {
      if (!caps.canRecord) {
        // 🔴 A platform that cannot record gets an explicit, honest refusal — not
        // a dead button, not a spinner that never resolves (design §8, §12.1).
        return { ok: false, code: 'unsupported', error: caps.reason ?? 'Запись недоступна.' };
      }

      const live = await getLive();
      if (isActive(live)) {
        // One session, ever. There is exactly one offscreen document per
        // extension, and a second recording would silently trample the first
        // (design §5.15). The popup turns this into "Уже пишем X. Остановить?".
        return {
          ok: false,
          code: 'busy',
          error: `Уже идёт запись${live?.host ? ` — ${live.host}` : ''}.`,
        };
      }
      // A stale record left by a dead owner must not block a new recording.
      if (live) {
        await markOrphansInterrupted();
        await setLive(null);
      }

      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const host = safeHost(tab?.url);
      const sessionId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (isFirefox) {
        // Firefox: the background CANNOT capture. tabCapture does not exist,
        // offscreen does not exist, and getDisplayMedia needs transient
        // activation, which a background script never has. So we open the WINDOW
        // and it performs the capture — one extra click plus Firefox's own source
        // picker. We explain that instead of hiding it (design §1.5, §4.4).
        await pendingItem.setValue(options);
        await openRecorderWindow();
        return { ok: true };
      }

      // ── CHROME. The ORDER below is the whole ballgame (design §1.5): the
      // streamId expires within SECONDS, so it is taken first and spent
      // immediately. Creating the window first — with its focus dance and
      // possible OS-level delay — would expire it.
      let streamId: string;
      try {
        if (options.source === 'screen') {
          // `desktopCapture` is an OPTIONAL permission, requested here from the
          // user's click and never at install time (design §3.1, §13).
          const granted = await browser.permissions.request({
            permissions: ['desktopCapture'],
          });
          if (!granted) return { ok: false, code: 'denied', error: 'Доступ к экрану не выдан.' };
          streamId = await getDesktopStreamId(tab);
        } else {
          if (tab?.id == null) return { ok: false, error: 'Нет активной вкладки.' };
          streamId = await getTabStreamId(tab.id);
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'CANCELLED') {
          return { ok: false, code: 'denied', error: 'Выбор источника отменён.' };
        }
        throw err;
      }

      await ensureOffscreen();

      const reply = (await browser.runtime.sendMessage({
        type: 'offscreen:start',
        streamId,
        options,
        sessionId,
        host,
        tabId: tab?.id ?? null,
      } satisfies Message)) as Reply | undefined;

      if (!reply?.ok) {
        await closeOffscreen();
        await setBadge('error');
        return reply ?? { ok: false, error: 'Offscreen-документ не ответил.' };
      }

      // ONLY NOW the window: the stream is already live, so the cost of creating
      // it cannot expire anything (design §1.5, step 6).
      const prefs = await prefsItem.getValue();
      if (prefs.openRecorderWindow) await openRecorderWindow();
      return { ok: true };
    }

    async function stop(): Promise<Reply> {
      const live = await getLive();
      if (!live) return { ok: true }; // nothing to stop — not an error
      await setBadge('processing');
      return relay({ type: 'offscreen:stop' }, { type: 'recorder:stop' });
    }

    async function togglePause(): Promise<Reply> {
      const live = await getLive();
      if (!isActive(live)) return { ok: true };
      return live?.status === 'paused'
        ? relay({ type: 'offscreen:resume' }, { type: 'recorder:resume' })
        : relay({ type: 'offscreen:pause' }, { type: 'recorder:pause' });
    }

    /** Send to whichever context actually owns the recording. */
    async function relay(toOffscreen: Message, toRecorder: Message): Promise<Reply> {
      const live = await getLive();
      const msg = live?.owner === 'recorder' || isFirefox ? toRecorder : toOffscreen;
      const reply = (await browser.runtime.sendMessage(msg).catch(() => undefined)) as
        | Reply
        | undefined;
      if (!reply) {
        // Nobody answered ⇒ the owner is gone. Never leave a live record — and a
        // REC badge — pointing at a corpse.
        await markOrphansInterrupted();
        await setLive(null);
        await setBadge('error');
        return {
          ok: false,
          error: 'Владелец записи не отвечает. Запись прервана; записанное сохранено — откройте Библиотеку.',
        };
      }
      return reply;
    }

    async function onSessionFinished(ok: boolean, reason?: string): Promise<void> {
      await setBadge(ok ? 'idle' : 'error');
      if (isFirefox) await pendingItem.setValue(null);
      await closeOffscreen();
      await closeRecorderWindow();
      if (ok && reason !== 'cancelled') {
        // No `notifications` permission is declared and none is requested for
        // this: an unused permission is a review flag. The finished clip opens in
        // the Studio instead — which is where the user was heading anyway.
        await openStudio('#/library');
      }
    }

    // ── SCREENSHOT (design §4.2, §5.14) ──────────────────────────────────────
    async function screenshot(): Promise<Reply> {
      if (!caps.canScreenshot) {
        return { ok: false, code: 'unsupported', error: 'Снимок вкладки недоступен.' };
      }
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      let blob: Blob;
      try {
        blob = await captureScreenshot(tab?.windowId);
      } catch (err) {
        // Carries the honest 2-per-second rate-limit message (design §5.14): a
        // silently swallowed click reads as "the extension is broken".
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      // OffscreenCanvas + createImageBitmap both work in a service worker, so no
      // offscreen document is needed for a screenshot (PLAN.md §6.3).
      const bitmap = await createImageBitmap(blob);
      const id = `shot-${Date.now()}`;
      const key = `blob-${id}`;
      await putBlob(key, blob);
      await putClip({
        id,
        kind: 'screenshot',
        title: `Скриншот · ${safeHost(tab?.url) || 'вкладка'}`,
        host: safeHost(tab?.url),
        createdAt: Date.now(),
        durationMs: 0,
        // The REAL, physical pixel size of the file (PLAN.md §6.2). We never show
        // the CSS viewport size and call it the image size.
        resolution: { width: bitmap.width, height: bitmap.height },
        format: 'png',
        mimeType: 'image/png',
        sizeBytes: blob.size,
        blobKey: key,
      });
      bitmap.close();
      await openStudio(`#/shot/${id}`);
      return { ok: true, id };
    }

    // ── Offscreen document lifecycle (CHROME ONLY — design §9.5) ─────────────
    // MediaRecorder needs a DOM, and a service worker has none. Reason USER_MEDIA
    // — NOT AUDIO_PLAYBACK, which auto-closes after 30 s and would truncate every
    // recording. Exactly one offscreen document may exist and createDocument
    // THROWS if one already does, so we always probe getContexts first (§1.5).
    async function hasOffscreen(): Promise<boolean> {
      if (isFirefox) return false;
      const rt = browser.runtime as unknown as {
        getContexts?: (f: { contextTypes: string[] }) => Promise<unknown[]>;
      };
      if (!rt.getContexts) return false;
      const contexts = await rt.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      return contexts.length > 0;
    }

    async function ensureOffscreen(): Promise<void> {
      if (isFirefox) return;
      if (await hasOffscreen()) return;
      const api = (
        globalThis as {
          chrome?: {
            offscreen?: {
              createDocument: (o: {
                url: string;
                reasons: string[];
                justification: string;
              }) => Promise<void>;
            };
          };
        }
      ).chrome?.offscreen;
      if (!api) throw new Error('chrome.offscreen недоступен.');
      await api.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification:
          'Recording a tab requires MediaRecorder, which needs a DOM that a service worker does not have.',
      });
    }

    async function closeOffscreen(): Promise<void> {
      if (isFirefox) return;
      if (!(await hasOffscreen())) return;
      const api = (
        globalThis as { chrome?: { offscreen?: { closeDocument: () => Promise<void> } } }
      ).chrome?.offscreen;
      try {
        await api?.closeDocument();
      } catch {
        /* already gone */
      }
    }

    // ── Recorder window (design §1.1, §2.3) ──────────────────────────────────
    // An OS WINDOW, not an extension popup: it survives focus loss, floats above
    // any tab, and its title bar carries the live timer into the taskbar. On
    // Firefox it also OWNS the stream.
    //
    // ⚠️ We REMEMBER the window id rather than scanning `windows.getAll()` for our
    // own URL: `tabs.Tab.url` is only populated with the `tabs` permission or a
    // matching host permission, neither of which we have (and neither of which we
    // are going to add for a lookup). A scan would silently return nothing and we
    // would open a second recorder window on every click. The id lives in
    // storage.session, so it survives service-worker eviction too.
    const RECORDER_URL = browser.runtime.getURL('/recorder.html');
    const STUDIO_URL = browser.runtime.getURL('/editor.html');

    async function recorderWindowId(): Promise<number | null> {
      const id = await recorderWinItem.getValue();
      if (id == null) return null;
      try {
        await browser.windows.get(id);
        return id;
      } catch {
        await recorderWinItem.setValue(null); // it is gone
        return null;
      }
    }

    async function hasRecorderWindow(): Promise<boolean> {
      return (await recorderWindowId()) != null;
    }

    browser.windows?.onRemoved.addListener((id) => {
      void (async () => {
        if ((await recorderWinItem.getValue()) === id) await recorderWinItem.setValue(null);
        // On FIREFOX the window IS the recorder, so its removal ends the recording.
        // The window itself flushes and closes the session on `pagehide`; this is
        // the backstop for the case where it did not get the chance.
        const live = await getLive();
        if (live?.owner === 'recorder') {
          await markOrphansInterrupted();
          await setLive(null);
        }
      })();
    });

    async function openRecorderWindow(): Promise<void> {
      const existing = await recorderWindowId();
      if (existing != null) {
        // Never two remotes for one session (design §10.6).
        await browser.windows.update(existing, { focused: true });
        return;
      }
      try {
        const win = await browser.windows.create({
          url: RECORDER_URL,
          type: 'popup',
          width: 400,
          height: 320,
          // Don't steal focus from the tab being recorded. ⚠️ Firefox may ignore
          // `focused:false` (open question, design §14.2 #7) — and there it must
          // be focused anyway, since the user has to click "Начать запись" inside
          // it to give getDisplayMedia its transient activation.
          focused: isFirefox,
        });
        if (win?.id != null) await recorderWinItem.setValue(win.id);
      } catch {
        // On Chrome the recording lives in the offscreen document regardless, so a
        // failed window is a degraded REMOTE, not a failed recording — and the
        // popup is still a remote (design §2.5).
      }
    }

    async function focusRecorderWindow(): Promise<void> {
      const id = await recorderWindowId();
      if (id != null) await browser.windows.update(id, { focused: true });
      else await openRecorderWindow();
    }

    async function closeRecorderWindow(): Promise<void> {
      const id = await recorderWindowId();
      if (id != null) await browser.windows.remove(id).catch(() => undefined);
      await recorderWinItem.setValue(null);
    }

    async function openStudio(hash = ''): Promise<void> {
      const url = STUDIO_URL + hash;
      const known = await studioTabItem.getValue();
      if (known != null) {
        try {
          await browser.tabs.update(known, { active: true, url });
          return;
        } catch {
          await studioTabItem.setValue(null); // the tab is gone
        }
      }
      const tab = await browser.tabs.create({ url });
      if (tab?.id != null) await studioTabItem.setValue(tab.id);
    }

    browser.tabs.onRemoved.addListener((id) => {
      void (async () => {
        if ((await studioTabItem.getValue()) === id) await studioTabItem.setValue(null);
      })();
    });

    async function defaultOptions(): Promise<StartOptions> {
      const p = await prefsItem.getValue();
      return {
        source: 'tab',
        // Firefox gets no tab audio, ever — the platform does not provide it.
        tabAudio: caps.canRecordTabAudio ? p.tabAudio : false,
        mic: p.mic,
        micDeviceId: p.micDeviceId,
        format: caps.canRecordMp4 ? p.defaultVideoFormat : 'webm',
        fps: p.defaultFps,
        maxHeight: p.defaultResolution?.height ?? null,
        quality: p.defaultQuality,
      };
    }
  },
});

function safeHost(url: string | undefined): string {
  // 🔴 From URL(tab.url).hostname, NEVER document.title — a page controls its own
  // title, and this string ends up in a FILENAME (design §9.4).
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
