import { browser } from '#imports';
import { openChromeStream } from '../../utils/media';
import { isMessage, type Message, type Reply } from '../../utils/messages';
import { RecordingSession } from '../../utils/session';

// OFFSCREEN DOCUMENT — CHROME ONLY, invisible (design capture.md §1.2, §9.5).
//
// It exists for exactly one reason: **MediaRecorder needs a DOM, and a service
// worker has none.** Reason `USER_MEDIA` — never `AUDIO_PLAYBACK`, which
// auto-closes after 30 s and would truncate every recording.
//
// It is the TRUE HOME of a Chrome recording: it owns the MediaStream, the
// MediaRecorder and the chunk writes, and it SURVIVES service-worker eviction
// (design §5.12). The SW can die and be reborn a dozen times while this document
// quietly keeps writing 3-second chunks to IndexedDB.
//
// ⚠️ It has NO UI, so it can never raise a permission prompt (design §5.9). The
// microphone grant must already exist — the visible recorder window asks for it,
// and the grant is per extension ORIGIN, so this document then gets the device
// silently. Missing grant ⇒ utils/media.ts degrades honestly: the video keeps
// recording without sound rather than the whole capture failing.

let session: RecordingSession | null = null;

browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  if (!isMessage(raw)) return false;
  const msg = raw as Message;
  if (!msg.type.startsWith('offscreen:')) return false; // not ours — don't hijack the reply

  void (async (): Promise<Reply> => {
    try {
      switch (msg.type) {
        case 'offscreen:start': {
          if (session) return { ok: false, code: 'busy', error: 'Запись уже идёт.' };
          // 🔴 The streamId was minted seconds ago in the service worker and is
          // spent RIGHT HERE, immediately (design §1.5, §10.2). No caching, no
          // "let me set the UI up first" — that is exactly what expires it.
          const stream = await openChromeStream(
            msg.streamId,
            msg.options.source === 'screen' ? 'desktop' : 'tab',
            msg.options,
          );
          const s = new RecordingSession({
            sessionId: msg.sessionId,
            owner: 'offscreen',
            stream,
            options: msg.options,
            source: msg.options.source,
            host: msg.host,
            tabId: msg.tabId,
          });
          await s.begin();
          session = s;
          return { ok: true };
        }
        case 'offscreen:stop':
          await session?.stop('user');
          session = null;
          return { ok: true };
        case 'offscreen:pause':
          await session?.pause();
          return { ok: true };
        case 'offscreen:resume':
          await session?.resume();
          return { ok: true };
        case 'offscreen:cancel':
          await session?.cancel();
          session = null;
          return { ok: true };
        case 'offscreen:mute':
          session?.setMuted(msg.muted);
          return { ok: true };
        case 'offscreen:ping':
          return { ok: true, recording: !!session };
        default:
          return { ok: false, error: 'unknown' };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  })().then(sendResponse);
  return true;
});

// Torn down while a recording is live (the SW closed us, the browser is shutting
// down): stop cleanly so the final chunk is flushed and the manifest is closed.
// An OOM kill grants no such courtesy — and that is exactly the case the on-disk
// manifest covers: it still says `recording`, the chunks up to the last flush are
// intact, and the library offers recovery (design §5.11, §10.5).
globalThis.addEventListener('pagehide', () => {
  void session?.stop('source-ended');
});
