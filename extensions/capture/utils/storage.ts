import { storage } from '#imports';
import type { Locale } from '@blur/ui';
import type {
  RecordingSource,
  ScreenshotFormat,
  SizePreset,
  VideoFormat,
  WatermarkPosition,
} from './types';

// Storage layout (design capture.md §3, §9.6).
//
// Three stores, deliberately split:
//   - `local:`   settings (this file). Theme + recording/export defaults + the
//                editable size-preset list + watermark defaults.
//                🔴 NOT `sync:` — design §9.6 is explicit: the sync quota is a
//                HARD 8,192 bytes PER ITEM and exceeding it fails the write, the
//                exact trap `blur` fell into (PLAN.md §18a). The editable preset
//                list is user-growable, so this belongs in `local`.
//   - `session:` the LIVE recording pointer (utils/live-state.ts) — dies with the
//                browser, which is correct: a pointer to a running recording has
//                no business surviving a restart.
//   - IndexedDB  recording CHUNKS, session manifests, clips, blobs (utils/db.ts).
//                🔴 Never a Blob array in storage.* — see utils/db.ts (§10.3).
//
// `version` + `migrations` are declared from day one so the schema can evolve
// without wiping user data on update.

/** Default platform ceilings (design §6.2). Editable and may be stale — we never
 *  hit the network to verify them; the UI says so under the chips (§6.2). */
export const DEFAULT_SIZE_PRESETS: SizePreset[] = [
  { id: 'discord', label: 'Discord', bytes: 10 * 1024 * 1024, hard: true },
  { id: 'discord-nitro', label: 'Discord Nitro', bytes: 500 * 1024 * 1024, hard: true },
  { id: 'email', label: 'Email / attachment', bytes: 25 * 1024 * 1024, hard: true },
  { id: 'github', label: 'GitHub / GitLab', bytes: 10 * 1024 * 1024, hard: true },
  { id: 'slack', label: 'Slack', bytes: 1024 * 1024 * 1024, hard: true },
  { id: 'telegram', label: 'Telegram', bytes: 2 * 1024 * 1024 * 1024, hard: true },
];

export interface CapturePrefs {
  theme: 'auto' | 'light' | 'dark';

  // Recording defaults (design §3.1). MP4 on Chrome, WebM on Firefox — but the
  // stored default is a preference; the live UI down-corrects it per browser
  // (Firefox cannot record MP4 — design §3.1, §8).
  /** 'screen' consumes the OPTIONAL `desktopCapture` permission, requested from
   *  the user's click and never at install (design §3.1). */
  source: RecordingSource;
  defaultVideoFormat: VideoFormat;
  /** null = "As-is" (record at the tab's native resolution — no upscale, §13). */
  defaultResolution: { width: number; height: number } | null;
  defaultFps: number;
  /** MediaRecorder videoBitsPerSecond tier. A WISH, not a guarantee — the exact
   *  size is only nailed on export (design §3.1, §8). */
  defaultQuality: 'high' | 'medium' | 'low';
  tabAudio: boolean;
  mic: boolean;
  micDeviceId: string;
  openRecorderWindow: boolean;

  // Export defaults (design §3.2).
  defaultExportFormat: VideoFormat;
  defaultTargetPresetId: string | null;
  maxPasses: number;
  /** e.g. "-10..0" — "under target is a success" (design §6.4). */
  tolerance: string;
  askWhereToSave: boolean;
  filenameTemplate: string;

  // Editable platform size ceilings (design §6.2).
  sizePresets: SizePreset[];

  // Watermark defaults (design §3.3).
  watermarkText: string;
  watermarkPosition: WatermarkPosition;
  watermarkOpacity: number;
  watermarkSizePct: number;
  watermarkByDefault: boolean;

  // Storage housekeeping (design §3.4). Default "never": silently deleting
  // someone's screencast is worse than using disk.
  autoDeleteDays: number | null;

  // Screenshots (design §6.6).
  defaultScreenshotFormat: ScreenshotFormat;

  // One-time "what we record and where it lives" disclosure (design §9.1).
  // Prominent-disclosure in the UI, shown once before the first recording.
  disclosureAccepted: boolean;
}

export const DEFAULT_PREFS: CapturePrefs = {
  theme: 'auto',
  source: 'tab',
  defaultVideoFormat: 'mp4',
  defaultResolution: null,
  defaultFps: 30,
  defaultQuality: 'high',
  tabAudio: true,
  mic: false,
  micDeviceId: '',
  openRecorderWindow: true,
  defaultExportFormat: 'mp4',
  defaultTargetPresetId: null,
  maxPasses: 3,
  tolerance: '-10..0',
  askWhereToSave: true,
  filenameTemplate: '{host}-{date}-{time}',
  sizePresets: DEFAULT_SIZE_PRESETS,
  watermarkText: '',
  watermarkPosition: 'bottom-right',
  watermarkOpacity: 60,
  watermarkSizePct: 4,
  watermarkByDefault: false,
  autoDeleteDays: null,
  defaultScreenshotFormat: 'png',
  disclosureAccepted: false,
};

export const prefsItem = storage.defineItem<CapturePrefs>('local:capturePrefs', {
  fallback: DEFAULT_PREFS,
  version: 1,
  migrations: {},
});

/** Watermark logo, kept as a Blob in IndexedDB under this key (design §9.6).
 *  🔴 There is deliberately no "logo URL" field anywhere: an external image
 *  taints the canvas and makes convertToBlob() throw at the END of an export,
 *  after minutes of encoding (design §9.3). */
export const LOGO_BLOB_KEY = 'watermark-logo';

/** localStorage seed key for flash-free theme (design §11.3, PLAN.md §18c). Same
 *  naming scheme as the family: 'blur-<ext>:theme'. */
export const THEME_SEED_KEY = 'blur-capture:theme';

/** Runtime UI language. English on a fresh install regardless of the browser
 *  locale — an in-settings switch, not `chrome.i18n` (see @blur/ui/i18n). Prefs
 *  live in IndexedDB-adjacent stores, but this pref is a single small string and
 *  belongs in `local:` beside the theme (design §9.6). */
export const localeItem = storage.defineItem<Locale>('local:locale', {
  fallback: 'en',
});

/** localStorage seed key for a flash-free first paint in the chosen language.
 *  Same naming scheme as the theme seed: 'blur-<ext>:locale'. */
export const LOCALE_SEED_KEY = 'blur-capture:locale';
