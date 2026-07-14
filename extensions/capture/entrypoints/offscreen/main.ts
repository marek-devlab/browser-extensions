import { browser } from '#imports';
import { todoLogic } from '@blur/ui';
import { openTabStream, addMicrophone, startRecorder } from '../../utils/media';
import { appendChunk } from '../../utils/recording-state';

// Offscreen document controller — CHROME ONLY (design capture.md §1.2, §9.5).
//
// Responsibilities (all stubbed; the wiring shape is real):
//   1. Receive {streamId, settings} from the background (design §1.5).
//   2. openTabStream(streamId) → getUserMedia(chromeMediaSourceId).
//   3. Optionally addMicrophone() — but the mic PROMPT cannot appear here (no UI
//      — design §5.9), so the background must have surfaced it from a visible
//      page first.
//   4. startRecorder(stream, onChunk) with a 3000 ms timeslice; every chunk goes
//      straight to IndexedDB via appendChunk (NEVER buffered — design §10.3).
//   5. Emit a heartbeat to the background every 5 s so a dead offscreen is
//      detected within 10 s and the session marked `interrupted` (design §5.11).
//
// This file survives service-worker eviction; it is the recording's true home.

browser.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type !== 'offscreen:start') return;
  void begin().catch((err) => {
    // A real failure here (stream open failed, quota) is reported to the
    // background so the badge goes to `error` and the user sees an honest notice
    // (design §5.6, §5.7) — never a silent dead recording.
    console.error(err);
  });
});

async function begin(): Promise<void> {
  // The real sequence, reaching the stubs so the flow is greppable and loud:
  const stream = await openTabStream('<streamId from background>');
  await addMicrophone(stream, '<deviceId>');
  startRecorder(stream, (blob) => {
    void appendChunk('<sessionId>', blob);
  });
  throw todoLogic('capture: offscreen begin — heartbeat + manifest wiring (§9.5/§10.1)');
}
