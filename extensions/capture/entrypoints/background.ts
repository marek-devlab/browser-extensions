import { defineBackground, browser } from '#imports';
import { todoLogic } from '@blur/ui';

// Background — SW (Chrome) / event page (Firefox). It is the keeper of the BADGE,
// the `commands` shortcuts, and the session registry, and on Chrome it
// orchestrates the offscreen document. It OWNS NOTHING about the recording itself
// (design §1.2, §10.1): the stream/recorder/chunks live in the offscreen doc
// (Chrome) or the recorder window (Firefox), so a 30-second SW eviction (design
// §5.12) kills only the badge, never the capture. On wake it rehydrates from
// getContexts() + the IndexedDB manifest.
//
// SCAFFOLD STATE: the badge writes and the command registration are REAL and
// wired. The capture orchestration they trigger (getMediaStreamId → offscreen →
// MediaRecorder) is stubbed in utils/media.ts + utils/recording-state.ts. Buttons
// therefore reach a loud todoLogic() rather than silently doing nothing.

type BadgeState = 'idle' | 'recording' | 'paused' | 'processing' | 'error';

const isFirefox = import.meta.env.FIREFOX;

export default defineBackground({
  main() {
    // ── BADGE: state only, NEVER a per-second timer (design §1.3) ─────────────
    // Writing `04:12` would (a) not fit ~4 glyphs and (b) wake the SW every
    // second — battery + a suspicious lifecycle profile for nothing. The badge
    // changes ONLY on a state transition; the real timer lives in the recorder
    // window's document.title (design §1.3).
    async function setBadge(state: BadgeState): Promise<void> {
      const map: Record<BadgeState, { text: string; color: string }> = {
        idle: { text: '', color: '#00000000' },
        recording: { text: 'REC', color: '#c5221f' },
        paused: { text: '❚❚', color: '#e37400' },
        processing: { text: '…', color: '#1a73e8' },
        error: { text: '!', color: '#c5221f' },
      };
      const { text, color } = map[state];
      // MV3 exposes browser.action; Firefox MV2 exposes browser.browserAction.
      // Pick whichever exists so the badge works on both targets.
      const action = browser.action ?? browser.browserAction;
      try {
        await action?.setBadgeText({ text });
        await action?.setBadgeBackgroundColor({ color });
      } catch {
        // action API unavailable (e.g. during teardown) — badge is advisory.
      }
    }
    void setBadge('idle');

    // ── COMMANDS: the global Stop/Pause/Record/Screenshot channel (design §1.3
    // ②, §11.1). Registered for real; the ACTIONS they call are stubbed. This is
    // the PRIMARY Stop — it must work from any window/tab/fullscreen, which is
    // exactly what an on-page overlay could never do (design §1.4). ───────────
    browser.commands?.onCommand.addListener((command) => {
      switch (command) {
        case 'start-recording':
          void startRecording();
          break;
        case 'stop-recording':
          void stopRecording();
          break;
        case 'toggle-pause':
          void togglePause();
          break;
        case 'screenshot':
          void takeScreenshot();
          break;
      }
    });

    // ── Session registry. In v1 there is exactly ONE session (one offscreen doc
    // / one recorder window — design §5.15). Mirrored to storage.session for fast
    // SW rehydration; the authoritative manifest is in IndexedDB (design §10.1). ─
    async function startRecording(): Promise<void> {
      await setBadge('recording');
      if (isFirefox) {
        // Firefox: the background CANNOT capture (no tabCapture/offscreen and no
        // transient activation for getDisplayMedia). It only opens the recorder
        // WINDOW, which owns the stream and prompts the user (design §1.5, §4.4).
        await openRecorderWindow();
        return;
      }
      // Chrome ordering is load-bearing (design §1.5): streamId first (it expires
      // in seconds), THEN the offscreen doc, THEN — only after the stream is
      // live — the recorder window. Encoded here as the real call sequence,
      // reaching the media stubs.
      throw todoLogic(
        'capture: Chrome start — getMediaStreamId → ensureOffscreen → recorder window (§1.5)',
      );
    }

    async function stopRecording(): Promise<void> {
      await setBadge('processing');
      // Real path: message offscreen (Chrome) / recorder window (Firefox) to
      // MediaRecorder.stop(), close the manifest, then badge → idle and notify.
      throw todoLogic('capture: stop → finalise session → notify (§4.1)');
    }

    async function togglePause(): Promise<void> {
      // Badge flips on the confirmed state change from the recorder, not here.
      throw todoLogic('capture: pause/resume (MediaRecorder.pause/resume — §5.2)');
    }

    async function takeScreenshot(): Promise<void> {
      // activeTab is already granted by the command gesture (design §4.2).
      throw todoLogic('capture: captureVisibleTab → editor (§4.2)');
    }

    // ── Offscreen document lifecycle (CHROME ONLY — design §9.5) ──────────────
    // MediaRecorder needs a DOM; the SW has none, so an offscreen document with
    // reason USER_MEDIA hosts it (USER_MEDIA has no 30 s auto-close, unlike
    // AUDIO_PLAYBACK). createDocument throws if one already exists, so ALWAYS
    // probe getContexts first (design §1.5, §9.5).
    async function ensureOffscreen(): Promise<void> {
      if (isFirefox) return; // no chrome.offscreen in Firefox
      throw todoLogic(
        'capture: getContexts(OFFSCREEN_DOCUMENT) → createDocument({reasons:[USER_MEDIA]}) (§1.5)',
      );
    }
    void ensureOffscreen;

    async function openRecorderWindow(): Promise<void> {
      // windows.create({type:'popup', focused:false}) — an OS window, not an
      // extension popup, so it survives focus loss and shows the timer in its
      // title bar / taskbar (design §1.1, §2.3). One window only: if a session is
      // already live, focus the existing one instead (design §10.6).
      try {
        await browser.windows.create({
          url: browser.runtime.getURL('/recorder.html'),
          type: 'popup',
          width: 380,
          height: 190,
          focused: false,
        });
      } catch {
        // If window creation fails on Chrome the recording still lives in the
        // offscreen doc; the popup remote (design §2.5) remains a fallback.
      }
    }

    // On wake, re-derive the badge from the persisted manifest so a resurrected
    // SW shows the right state (design §10.1). Stubbed read for now.
    async function rehydrate(): Promise<void> {
      throw todoLogic('capture: rehydrate badge from getContexts + IDB manifest (§10.1)');
    }
    void rehydrate;
  },
});
