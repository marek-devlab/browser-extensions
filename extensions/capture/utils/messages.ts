import { browser } from '#imports';
import type { RecordingSource, VideoFormat } from './types';

// The message protocol. Small, typed, and deliberately RPC-shaped: every request
// gets an explicit reply, so a caller never has to guess whether "nothing
// happened" meant success (design §8 — an honest UI needs an honest transport).
//
// Who listens to what:
//   background  ← popup / recorder / studio  (start, stop, pause, cancel, shot)
//   offscreen   ← background                  (offscreen:*)
//   recorder    ← background                  (recorder:*)
// Each listener answers ONLY its own prefix, so the "multiple listeners race for
// sendMessage" trap cannot bite.

export interface StartOptions {
  source: RecordingSource;
  tabAudio: boolean;
  mic: boolean;
  micDeviceId: string;
  format: VideoFormat;
  fps: number;
  /** null = record at the tab's native size; we never upscale (design §13). */
  maxHeight: number | null;
  quality: 'high' | 'medium' | 'low';
}

export type Message =
  | { type: 'capture:start'; options: StartOptions }
  | { type: 'capture:stop' }
  | { type: 'capture:pause' }
  | { type: 'capture:resume' }
  | { type: 'capture:cancel' }
  | { type: 'capture:mute'; muted: boolean }
  | { type: 'capture:screenshot' }
  | { type: 'recorder:focus' }
  // background → offscreen (Chrome only)
  | { type: 'offscreen:start'; streamId: string; options: StartOptions; sessionId: string; host: string; tabId: number | null }
  | { type: 'offscreen:stop' }
  | { type: 'offscreen:pause' }
  | { type: 'offscreen:resume' }
  | { type: 'offscreen:cancel' }
  | { type: 'offscreen:mute'; muted: boolean }
  | { type: 'offscreen:ping' }
  // background → recorder window (Firefox: the window OWNS the stream)
  | { type: 'recorder:stop' }
  | { type: 'recorder:pause' }
  | { type: 'recorder:resume' }
  | { type: 'recorder:cancel' }
  | { type: 'recorder:mute'; muted: boolean }
  // owner → background: a recording ended; badge + notification + library
  | { type: 'session:finished'; sessionId: string; ok: boolean; reason?: string }
  | { type: 'session:heartbeat' };

export type Reply =
  | { ok: true; [k: string]: unknown }
  | { ok: false; error: string; code?: 'busy' | 'unsupported' | 'denied' | 'expired' | 'quota' };

export function send<T = Reply>(message: Message): Promise<T | undefined> {
  // A rejected sendMessage means "nobody was listening" — a legitimate state
  // (e.g. no offscreen document). Callers branch on `undefined`, never on a
  // thrown error, so a missing listener can't masquerade as a failed action.
  return browser.runtime.sendMessage(message).catch(() => undefined) as Promise<T | undefined>;
}

export function isMessage(x: unknown): x is Message {
  return typeof x === 'object' && x !== null && typeof (x as { type?: unknown }).type === 'string';
}
