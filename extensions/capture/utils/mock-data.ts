import { MOCK } from '@blur/ui';
import type { Clip, RecordingSession } from './types';

// Fabricated data for the scaffold (design capture.md §2.13 library, §2.3
// recorder). Every surface rendering these ALSO shows <MockBadge/> so no number
// is ever mistaken for a real measurement (the "48 907" fake-number bug the
// house rule exists to prevent — @blur/ui mock.ts, PLAN.md §18a).
void MOCK;

const HOUR = 3600_000;

/** A fake IN-PROGRESS session, so the recorder window + popup have something to
 *  drive the (REAL, ticking) timer against. `startedAt` is offset so the timer
 *  begins around 4:12, matching the design mockups. */
export const MOCK_SESSION: RecordingSession = {
  id: 'sess-mock-1',
  status: 'recording',
  source: 'tab',
  host: 'example.com',
  startedAt: Date.now() - 252_000, // ~4:12 ago
  durationMs: 252_000,
  bytesOnDisk: 148 * 1024 * 1024,
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  format: 'mp4',
  tabAudio: true,
  mic: true,
};

/** A fake finished clip to open in the editor (design §2.6). */
export const MOCK_CLIP: Clip = {
  id: 'clip-mock-1',
  kind: 'video',
  title: 'Dashboard demo',
  host: 'example.com',
  createdAt: Date.now() - 2 * HOUR,
  durationMs: 252_000,
  resolution: { width: 1920, height: 1080 },
  format: 'mp4',
  sizeBytes: 312 * 1024 * 1024,
};

/** The library list, including a recovered/interrupted entry (design §2.13). */
export const MOCK_LIBRARY: Clip[] = [
  MOCK_CLIP,
  {
    id: 'clip-mock-2',
    kind: 'screenshot',
    title: 'Скриншот · login',
    host: 'example.com',
    createdAt: Date.now() - 3 * HOUR,
    durationMs: 0,
    resolution: { width: 2560, height: 1440 },
    devicePixelRatio: 2,
    format: 'png',
    sizeBytes: Math.round(1.8 * 1024 * 1024),
  },
  {
    id: 'clip-mock-3',
    kind: 'video',
    title: 'Onboarding walkthrough',
    host: 'app.example.com',
    createdAt: Date.now() - 26 * HOUR,
    durationMs: 761_000,
    resolution: { width: 1280, height: 720 },
    format: 'webm',
    sizeBytes: 690 * 1024 * 1024,
  },
];

/** A fake "interrupted recording" recovery card model (design §2.13, §10.5). */
export const MOCK_INTERRUPTED = {
  id: 'sess-mock-interrupted',
  host: 'example.com',
  when: '14 июля, 16:42',
  durationMs: 761_000,
  bytes: 187 * 1024 * 1024,
};

/** Total library footprint shown in the header (design §2.13). */
export const MOCK_LIBRARY_BYTES = MOCK_LIBRARY.reduce((n, c) => n + c.sizeBytes, 0);

/** Rough free-disk estimate for the recorder's "≈ 41 GB free" line (design §2.3).
 *  Real impl uses navigator.storage.estimate() (design §5.6). */
export const MOCK_FREE_BYTES = 41 * 1024 * 1024 * 1024;
