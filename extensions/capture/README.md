# Capture Studio

A WXT + React + TypeScript browser extension that records a browser tab, takes
screenshots, and exports the result — trimmed, redacted, watermarked, and
compressed to a target format, resolution or **file size**. Chrome (MV3) and
Firefox (MV2) build from the same codebase, but they do **not** share a capture
pipeline, and they cannot.

**Single purpose:** _"Record a tab and export media."_

**Everything is local.** There is not one network request. The extension-pages CSP
carries `connect-src 'none'`, which makes network access structurally impossible
rather than merely absent. No analytics, no cloud, no accounts, no sharing links.

## 🔴 Desktop only — and we say so

There is **no mobile support and there cannot be**. Firefox for Android has no
`tabCapture`, no `chrome.offscreen`, no `windows.create` and no
`getDisplayMedia`; WebCodecs is absent there too. Chrome for Android has no
extensions at all.

The extension does not pretend otherwise: it feature-detects at startup, and on a
platform that cannot record it shows an explicit **"Запись на этой платформе
недоступна"** panel — never a dead Record button, never a spinner that resolves to
nothing. Screenshots, which do work there, stay available. The manifest omits
`gecko_android` deliberately: claiming Android compatibility for an add-on that
cannot capture a single frame would be a lie in the manifest.

## The two capture pipelines

| | Chrome (MV3) | Firefox (MV2) |
|---|---|---|
| Who asks for the stream | background: `tabCapture.getMediaStreamId()` | **`recorder.html` window**: `getDisplayMedia()` |
| Who owns MediaStream + MediaRecorder | **offscreen document** (`reasons: ['USER_MEDIA']`) | **the recorder window** |
| Survives service-worker death | ✅ yes | ✅ yes (no SW involved) |
| Closing the recorder window | recording continues | **stops** the recording (the window *is* the recorder) |
| Tab / system audio | ✅ | 🔴 **impossible** — see below |
| Records MP4 directly | ✅ Chrome 126+ | ❌ WebM only; MP4 = a re-encode at export |
| Clicks to start | 1 | 2 (+ the browser's own source picker) |

`chrome.offscreen` and `chrome.tabCapture` **do not exist in Firefox**. The
Firefox build therefore declares neither permission, and `offscreen.html` is not
even emitted into that bundle.

### 🔴 Firefox cannot record tab audio. At all.

`getDisplayMedia()` in Firefox returns **no audio track** (BCD:
`audio → version_added: false`). This is a missing platform capability, not a
setting we turned off, and there is no workaround. The Firefox build therefore
records **video only**, plus the **microphone** if you enable it — which is the
sole reason the microphone is a v1 feature rather than a v2 one: without it, the
Firefox build would be silent.

The UI does not hide this behind a greyed-out checkbox (a disabled control reads
as *"I misconfigured something"*). The control is **removed** and replaced with the
explanation. Same rule for MP4: Firefox's `MediaRecorder` cannot write it, so the
format picker shows only WebM and says why — we never write WebM bytes into a
`.mp4` file.

### 🔴 Firefox and H.264 encoding

Whether Firefox's `VideoEncoder` can encode H.264 is not confirmed by any primary
source, so the extension **asks the machine at runtime**:
`VideoEncoder.isConfigSupported({ codec: 'avc1.42001f' })`, before MP4 is offered
as an export option. If the answer is no, MP4 is not on the menu and the reason is
printed. We do **not** bundle ffmpeg.wasm to paper over it: its core is ~30 MB, its
licence is GPL-tainted (x264), AMO would demand reproducible WASM sources, and its
default `load()` pulls the core from unpkg — **remotely hosted code, an instant
store rejection**.

## Where the Stop button lives

There is **no on-page overlay**, and there never will be. Not (only) because it
would need `<all_urls>`, but because **`tabCapture` records the tab composite**: an
injected Stop button would be **baked into the video**. Three independent channels
instead, none of which touch the page:

1. **The badge** — state only (`REC` / `❚❚` / `…` / `!`), written on state
   *transitions*. Never a per-second clock: that would wake the service worker
   once a second, for a number that does not fit in four glyphs anyway.
2. **A global `commands` shortcut** — `Alt+Shift+S` is the *primary* Stop. It works
   from any window, any tab, a fullscreen video, or another application entirely.
3. **The recorder window** (`recorder.html`) — a real OS window, not an extension
   popup (a popup dies on focus loss and would take the stream with it). It carries
   the live timer in `document.title`, so the clock is visible in the **taskbar**
   even when the window is behind everything else.

The popup is a fourth, fallback remote: clicking the icon mid-recording shows the
recording panel, never the setup form again.

## A recording is never silently lost

A corrupted recording is a total loss, so every failure mode ends in a recoverable
artifact:

- **`MediaRecorder.start(3000)`** — the timeslice is mandatory. Every 3 s a chunk
  goes **straight into IndexedDB**. Nothing accumulates in RAM; a two-hour
  recording has a flat memory profile. There is no `chunks.push()` anywhere.
- The **session manifest** is written to disk *before the first byte of media*, so
  even a crash two seconds in leaves a self-describing record.
- **Service worker dies** (~30 s idle): nothing happens. The SW owns nothing. On
  wake it rehydrates from `runtime.getContexts()` + the manifest.
- **Offscreen document / recorder window crashes**: the heartbeat stops, the badge
  flips to `!` (it is *derived* from the live record, so it cannot keep claiming
  `REC`), the session is marked `interrupted`, and the library offers **recovery**
  of everything up to the last flush — at most ~3 seconds are lost.
- **Disk full** (`QuotaExceededError`): stop and finalise. Twelve minutes of work
  are not thrown away because the thirteenth did not fit.
- **The user ends the share from the browser's own indicator**, or closes the
  recorded tab: `track.onended` → the ordinary Stop path. Reported as *stopped*,
  not as an error — the user did exactly what they meant to, just with a different
  button.
- **The encode wedges** (a WebCodecs pipeline out of buffers does not throw, it
  simply stops moving): a watchdog aborts it after 45 s without progress. The
  source recording is never touched before a successful export.

## The killer feature: target file size

No browser has two-pass rate control, and `MediaRecorder.videoBitsPerSecond` is a
*wish* the browser may ignore. So the size target is applied at **export**, never
at record time, as an iterative manual 2-pass:
`newBps = bps × target ÷ actual`, clamped to ±40% per pass and floored at
0.015 bit/pixel.

The real value, though, is the **arithmetic before the encode**:

```
budget_bits = target × 8 × 0.97      (3% for container overhead)
video_bps   = (budget_bits − audio_bps × duration) / duration
bpp         = video_bps / (width × height × fps)
```

That runs in microseconds and tells you that 3:42 of 1080p30 in 10 MB is
**0.004 bit/pixel — mush** *before* you burn three minutes of CPU discovering it.
When the plan is mush the export button is **blocked** (the only blocked action in
the product) until you apply one of the re-computed escape routes — downscale, drop
fps, drop audio (whose weight in MB is shown right on its own checkbox, because on
a short clip it eats a third of the budget), or trim.

Undershoot counts as a hit: 8.9 MB against a 10 MB target is **done**.

## Hiding secrets: fill only

**Solid fill is the only protection mode.** It deletes the pixels; nothing about it
is written into the file — no layer, no alpha hole, no annotation metadata (that is
how PDF redactions leaked for years).

**Blur and pixelation are reversible.** Unredacter (Bishop Fox, 2022) and Depix
recover text — passwords and API keys included — from blurred and pixelated
images, publicly. So they live in a physically separate group titled **"Косметика —
НЕ защита"** with a warning that cannot be collapsed, and they render as dashed
amber boxes labelled `косметика`, so the difference is visible to the eye and not
only readable in a paragraph.

Two traps this product refuses to fall into:

- "Export without re-encoding" (stream copy) **cannot** apply a fill. If any
  redaction, watermark, resize or size target exists, that option is disabled with
  the reason. Silently ignoring the fill and handing over the clean file would be
  the worst bug this extension could ship.
- After an export, the **original, un-redacted recording is still in the library**.
  We say so, and offer to delete it. (Never by default — silently deleting user
  data is not a feature.)

⚠️ A redaction rectangle **does not track content**. If what is under it scrolls,
the secret slides out from beneath it. The UI says this, and the interval defaults
to the whole clip.

## Permissions, and why each one exists

| Permission | Why | Where |
|---|---|---|
| `storage` | settings (`local:`), the live recording pointer (`session:`) | both |
| `unlimitedStorage` | hours of video as IndexedDB chunks | both |
| `downloads` | save the exported file (the only save path on Firefox) | both |
| `activeTab` | the toolbar-click grant that lets `tabCapture` attach without `<all_urls>` | both |
| `tabCapture` | `getMediaStreamId()` for the active tab | **Chrome only** |
| `offscreen` | the invisible document that hosts `MediaRecorder` (a service worker has no DOM) | **Chrome only** |
| `desktopCapture` | **optional.** Requested from a click on "Записать весь экран", never at install | **Chrome only** |

🔴 No `<all_urls>`. No `tabs`. No `scripting`. No `notifications`. No
`clipboardWrite` (the async clipboard API works from a focused extension page
without it). Anything declared is used on the browser that declares it.

## Encoding stack

**WebCodecs + [mediabunny](https://github.com/Vanilagy/mediabunny)** (MPL-2.0).
`mp4-muxer` / `webm-muxer` are **deprecated by their own author** and are not used.
ffmpeg.wasm is **not bundled**.

Every `VideoFrame` is closed — by construction, not by discipline: the code never
constructs a raw `VideoFrame` and never touches `VideoEncoder` directly. The
per-frame hook draws onto one reused `OffscreenCanvas` and hands it back; mediabunny
wraps, encodes, closes, and applies encoder backpressure. In the export path frames
are **waited on, never dropped** — dropping in post-processing means missing frames
in the result.

⚠️ **Known ceiling:** a re-encode materialises its output in an `ArrayBuffer`. For a
size-targeted export this is bounded by the target and is a non-issue; for an
unbounded re-encode of a recording larger than ~1.5 GB the UI warns *before*
starting and points at "как записано" (stream copy — instant, no RAM) or trimming.

The watermark logo may only come from a **local file**. There is no "logo URL"
field, deliberately: an external image taints the canvas and `convertToBlob()`
throws a `SecurityError` at the *end* of an export, after minutes of encoding.

## Run

From the monorepo root:

```bash
npm install
npm run dev:capture            # Chrome
npm run dev:capture:firefox    # Firefox
```

Build / typecheck:

```bash
npm run compile -w @blur/capture
cd extensions/capture && npx wxt build && npx wxt build -b firefox
```

## Privacy

Recordings, screenshots and settings never leave the machine. A privacy policy is
nevertheless **mandatory** (Chrome Web Store requires disclosure "even when data is
processed or stored locally"), and the extension shows a one-time **prominent
in-UI disclosure** — in the interface, not just the store listing — stating what is
recorded, where it lives (IndexedDB, in the browser profile) and where it goes
(nowhere). See `PRIVACY.md` at the repo root.
