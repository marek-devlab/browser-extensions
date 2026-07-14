# Capture Studio — implementation notes

Extension #5. Single purpose: **"Record a tab and export media."** Built as a
UI-complete SCAFFOLD (all surfaces, navigation and settings persistence real;
media domain logic stubbed on mocks). Authoritative spec: `docs/design/capture.md`
(referenced as "§n" below). Reuses PLAN-2 §1/§10.4 and PLAN.md §6.

## Surface map

| Surface | Entrypoint | Output | Role |
|---|---|---|---|
| Popup remote | `entrypoints/popup/` | `popup.html` | 320px. Pre-record setup + Record/Screenshot; fallback recording panel (§2.1, §2.2, §2.5). The single gesture that yields `activeTab`/`tabCapture` (§1.1). |
| Recorder window | `entrypoints/recorder/` | `recorder.html` | Separate OS window (`windows.create({type:'popup',focused:false})`). Real ticking timer + `document.title` clock, pause/stop/two-step cancel. On **Firefox** it also OWNS the stream (§1.1, §2.3, §2.4). |
| Offscreen | `entrypoints/offscreen/` | `offscreen.html` | **Chrome only, invisible.** Hosts `MediaRecorder` (no DOM in a SW — §9.5). Streams chunks to IndexedDB. |
| Studio | `entrypoints/editor/` | `editor.html` | Full tab. Tabs: Library · Editor · Export · Settings, plus the Screenshot editor (§2.6–§2.13). |
| Options | `entrypoints/options/` | `options.html` | Renders the shared `<Settings/>` (real persistence). See "Options shape" below. |
| Background | `entrypoints/background.ts` | SW / event page | Badge, `commands`, session registry, offscreen orchestration. **Owns nothing** about the recording (§1.2, §10.1). |

## Where the recording controls live — the central decision (§1.3, §1.4)

There is **no on-page overlay**, ever: `tabCapture` records the tab COMPOSITE, so
an injected Stop button would bake into the video (§1.4). Controls live in three
independent channels, none touching the page:

1. **Badge** — state only (`REC`/`❚❚`/`…`/`!`), NEVER a per-second timer (writing
   the clock would wake the SW every second — §1.3). `background.ts setBadge()` is
   real (MV3 `action` / MV2 `browserAction`).
2. **Global `commands` shortcut** — the PRIMARY Stop (`Alt+Shift+S`), plus
   Record/Pause/Screenshot. Declared in `wxt.config.ts` (a manifest KEY, no
   warning), listener wired in `background.ts` (§1.3 ②). Works from any window /
   tab / fullscreen / other app.
3. **Recorder window** — the only surface with a real timer; on Firefox it is the
   recorder itself. `document.title` mirrors the clock into the OS taskbar (§1.3).

Popup is a fourth, fallback remote (§2.5) — clicking the icon mid-record shows the
recording panel, never the setup form.

## Chrome-offscreen vs Firefox-page divergence (§1.2, §12, encoded in the manifest)

| | Chrome (MV3) | Firefox (MV2) |
|---|---|---|
| Capture call | `tabCapture.getMediaStreamId` (background) | `getDisplayMedia()` from **recorder.html** |
| Owns MediaStream/Recorder | **offscreen doc** | **recorder window** |
| Permissions | + `tabCapture`, `offscreen` | neither exists — omitted |
| Tab audio | yes | **impossible** (`getDisplayMedia` audio:false) — §1.1, §8 |
| Record format | MP4 or WebM | WebM only; MP4 = export-time re-encode (§4.4) |
| Extra click | no | yes — transient activation + browser picker (§1.5) |
| Close recorder window | recording continues | **stops** recording (window = recorder) — guarded by `beforeunload` |

`wxt.config.ts` branches `permissions`/`optional_permissions`/`content_security_policy`
on `browser`, with the reasoning in comments. Firefox `gecko` id `capture@blockaly.com`,
`data_collection_permissions.required:['none']`. **`gecko_android` deliberately
OMITTED** — capture is physically non-functional on mobile (no getDisplayMedia/
tabCapture/WebCodecs there — §8, §12.1); claiming Android-compat would be a
manifest lie.

## Service-worker death → state in offscreen + IndexedDB (§5.12, §10.1)

The SW is evicted at ~30 s idle. It **owns nothing**: the stream/recorder/chunks
live in the offscreen doc (Chrome) or recorder window (Firefox); the authoritative
session manifest is in **IndexedDB**, updated on every 3 s chunk flush; a
`{id,status}` mirror sits in `storage.session` for fast rehydration. On wake the SW
does `getContexts()` + reads the manifest and restores only the badge. This is
scaffolded in `utils/recording-state.ts` (stubbed) and `background.ts rehydrate()`.
**Recording chunks NEVER go to storage.local as a Blob array, and NEVER
`chunks.push()` in RAM** (§10.3) — each `ondataavailable` writes straight to IDB.

## What is REAL vs MOCKED

**Real now**
- All surfaces + layouts (popup setup + both browser variants, recorder window,
  Studio Library/Editor/Export/Screenshot/Settings).
- **Recording timer** — genuine `setInterval` 1 Hz in the surface's own document
  (`utils/use-ticker.ts`), driving the recorder clock + `document.title`.
- **Pre-encode budget math** — `utils/budget.ts`, implemented in full:
  `videoBps = (target·8·0.97 − audio_bps·dur)/dur`, `bpp = videoBps/(w·h·fps)`, the
  quality scale, the export-blocked-on-"mush" rule, and re-computed suggestions.
  The Export dialog's budget panel, achievable/unreachable copy and audio-weight
  label all read these real numbers (§2.7–§2.10, §6.3).
- **Filename sanitisation** — `utils/format.ts` (path traversal, illegal chars,
  Windows reserved names, 255-byte clamp) (§9.4).
- Settings persistence — `usePrefs` → `sync:capturePrefs` (`utils/storage.ts`).
- Theme — `@blur/ui` tokens + `seedTheme('blur-capture:theme')` in every main.tsx.
- Badge state wiring + global `commands` registration (§1.3).
- Firefox-degraded variants: tab audio and MP4-record shown by REMOVING the
  control + explaining, never a disabled checkbox (§2.2, §8).
- Redaction tool UI: solid-fill default alone under "Скрыть данные"; blur/pixelate
  in a separate "Косметика — НЕ защита" group with the non-collapsible
  Unredacter/Depix warning (§7).
- States surfaced in UI: recording, paused, interrupted-recovery card,
  target-unreachable, budget-mush block, DPR line.

**Mocked / stubbed** (loud `todoLogic('capture: …')`, `<MockBadge/>` on fabricated
surfaces, `mockAsync` for the fake 2-pass progress)
- All actual capture/encode/mux (`utils/media.ts`), chunk persistence
  (`utils/recording-state.ts`), and the background orchestration that calls them.
- The 2-pass encode progress is faked with `mockAsync`; the math it starts from is
  real.
- Library/recorder figures come from `utils/mock-data.ts`.
- Redaction PIXEL operations (fill/blur/pixelate) and watermark compositing.

## Every TODO_LOGIC (grep `TODO_LOGIC`)

`utils/media.ts`: getTabStreamId · openTabStream · openDisplayStream (Firefox) ·
addMicrophone (§5.9) · startRecorder (timeslice 3000) · captureScreenshot (2/sec,
DPR) · canEncodeH264 (isConfigSupported, §12.1) · composeAndMux (fill to pixels,
§7.4) · runTargetEncode (2-pass, §6.4) · encodeImageToTarget (§6.6).
`utils/recording-state.ts`: openRecordingDb · appendChunk · writeManifest ·
findInterruptedSessions · readChunks.
`entrypoints/background.ts`: Chrome start sequence · stop · pause/resume ·
screenshot · ensureOffscreen (getContexts→createDocument) · rehydrate.
`entrypoints/offscreen/main.ts`: offscreen begin (heartbeat + manifest).

## Privacy policy (MANDATORY even though 100% local — §9.1, PLAN-2 §1.4)

A privacy policy is required **even when data is processed/stored only locally**.
The repo's `PRIVACY.md` must gain a `capture` section: what is recorded (tab
video/audio; microphone only on explicit opt-in), where it lives (IndexedDB in the
browser profile), how long (until the user deletes it), where it goes (nowhere —
CSP `connect-src 'none'`). In-UI **prominent disclosure** (CWS 2026-08-01) is
scaffolded as the one-time "what we record and where it lives" callout in the
Studio, persisted via `prefs.disclosureAccepted` (§9.1). `THIRD-PARTY-NOTICES.md`
must note mediabunny (MPL-2.0): edits INSIDE its files must be published; linking
need not (§12.2).

## Options shape (design nuance)

The design prefers a SINGLE surface: options → `editor.html#/settings`, to avoid a
second entry point (§1.1, §2). This scaffold keeps a thin `entrypoints/options/`
(house convention, cf. `extensions/blur`) mounting the same `<Settings/>` — real
persistence, one source of truth. The Studio also deep-links `#/settings`.
Consolidating to the design's exact shape is a one-line `options_ui.page` change.
`open_in_tab: true` is required so Firefox doesn't render it in the narrow
`about:addons` frame (§1.1) — confirm WXT emits it, else set it in the manifest.

## Not done / to verify on first build

- Icons: `public/icon/.gitkeep` only — generate `{16,32,48,128}.png` (TODO).
- No `npm install` / `wxt prepare` / build / typecheck run (per task). `#imports`
  and `.wxt/` types resolve only after `wxt prepare`.
- Open questions from §14.2 (offscreen mic grant, Chrome tabCapture indicator,
  occlusion throttling, Firefox H.264 encode, pause timestamps, `focused:false`
  respect on Firefox, live platform limits) must be checked on real browsers.
