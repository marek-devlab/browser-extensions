# Capture Studio — implementation notes

Extension #5. Single purpose: **"Record a tab and export media."**
Authoritative spec: `docs/design/capture.md` (referenced as "§n" below), plus
PLAN-2 §1 and PLAN.md §6.

**Status: the domain logic is REAL.** The mocks (`utils/mock-data.ts`,
`<MockBadge>`, `mockAsync`, every `todoLogic()`) are gone. What remains
unverified is listed at the bottom, honestly.

## Surface map

| Surface | Entrypoint | Role |
|---|---|---|
| Popup | `entrypoints/popup/` | 320px remote. Setup form + Record/Screenshot; the recording panel when a capture is live (§2.5). The toolbar click is the ONE gesture that yields `activeTab` (§1.1). Owns nothing — it dies on focus loss. |
| Recorder window | `entrypoints/recorder/` | A real OS window (`windows.create({type:'popup'})`). Live timer + `document.title` clock (→ taskbar), pause/stop/two-step cancel, mic meter. On **Firefox it OWNS the stream** (§1.2, §2.4). |
| Offscreen | `entrypoints/offscreen/` | **Chrome only, invisible.** Hosts `MediaRecorder` (no DOM in a SW — §9.5). Excluded from the Firefox bundle via `<meta name="wxt.exclude" content="['firefox']">`. |
| Studio | `entrypoints/editor/` → `editor.html` | Library · Editor · Export · Settings + the screenshot editor. Hash routes: `#/library`, `#/settings`, `#/clip/<id>`, `#/shot/<id>`. |
| Options | `entrypoints/options/` | Renders the shared `<Settings/>`. `open_in_tab: true` (else Firefox renders it in the narrow `about:addons` frame — §1.1). |
| Background | `entrypoints/background.ts` | Badge, `commands`, the Chrome start sequence, screenshots, window/tab bookkeeping, rehydration. **Owns nothing about the recording** (§1.2, §10.1). |

## Where state lives — the table everything else follows from

| | Chrome | Firefox |
|---|---|---|
| `MediaStream` / `MediaRecorder` | offscreen document | recorder window |
| Chunk writes | offscreen document | recorder window |
| Live state (`storage.session['live']`) | written by the offscreen doc | written by the recorder window |
| Session manifest + chunks (IndexedDB) | on disk, updated every flush | same |
| Service worker | **owns nothing**; derives the badge | event page; same |

🔴 **Nothing about a recording is ever held in a service-worker variable.** The SW
is evicted at ~30 s idle; anything it "remembers" evaporates, and the classic bug
of the genre — a badge still saying REC over a recording that no longer exists —
follows immediately. Instead:

- **`utils/live-state.ts`** — the live record in `storage.session`, written ONLY by
  whoever holds the `MediaRecorder`, heartbeat every 2 s. The badge *subscribes* to
  it. The badge is therefore a pure function of the recorder's own state and cannot
  form an independent (wrong) opinion.
- **`utils/db.ts`** — IndexedDB: `chunks` (`[sessionId, seq]`), `sessions`
  (manifests), `clips`, `blobs`. The manifest is written **before the first media
  byte** and updated in the **same transaction** as each chunk, so a crash can
  never leave a manifest claiming more chunks than exist on disk.

## What is REAL

- **Both capture pipelines.** Chrome: `tabCapture.getMediaStreamId()` → `getContexts()` →
  `offscreen.createDocument({reasons:['USER_MEDIA']})` → `getUserMedia({mandatory:{chromeMediaSource:'tab',…}})`
  → `MediaRecorder`, in that exact order (the streamId expires in seconds — §1.5).
  Firefox: `getDisplayMedia()` from the recorder window, behind the unavoidable
  second click (transient activation).
- **Chunked recording** — `MediaRecorder.start(3000)`; each chunk straight to IDB.
- **Pause/resume/stop/cancel/mute**, badge, global `commands`, recovery.
- **Screenshots** — `tabs.captureVisibleTab`, 2/sec limit enforced *by us* with a
  greyed button (a swallowed click reads as "broken"), PNG/JPEG/WebP output.
- **Redaction** — fill/blur/pixelate baked into pixels via `OffscreenCanvas`;
  fractional coordinates (DPR-correct by construction — PLAN.md §6.2).
- **Watermark** — `fillText` + optional local-file logo, sized as a % of frame height.
- **Trim**, **export**, **format/resolution/fps conversion** — mediabunny `Conversion`.
- **Target file size** — real budget math + the iterative manual 2-pass with early
  pass abort, bitrate clamping and the bpp floor.
- **H.264 probe** — `VideoEncoder.isConfigSupported({codec:'avc1.42001f'})` before
  MP4 is offered.
- **Save** — File System Access when available (streams the blob, no second copy),
  otherwise `downloads.download` + **`revokeObjectURL`** (on `downloads.onChanged`,
  plus an unconditional timeout backstop — a listener that never fires is how leaks
  ship).
- **Import your own file** — drag-drop / file input into the same pipeline. No URL
  field, ever (§4.3).
- **Settings** — `local:capturePrefs` (🔴 not `sync:`: the 8 KB-per-item quota is a
  hard failure, and the size-preset list is user-growable — §9.6).
- **Prominent in-UI disclosure**, one-time, persisted.
- **Platform probe** — `utils/platform.ts`. A platform that cannot record gets an
  explicit "not supported" panel and keeps screenshots working.

## Deliberately NOT built (and why)

- **Live watermark overlay during recording.** `MediaStreamTrackProcessor` does not
  exist in Firefox; the cross-browser path (`canvas.captureStream()`) burns CPU
  *during* the recording, drops fps and damages the material itself. Post-export
  overlay gives an identical result and can be changed without re-recording (§4.5).
- **ffmpeg.wasm.** Not bundled. See README.
- **Region tracking** in video redaction. Bad tracking is *worse* than none: it
  creates false confidence (§7.5).
- **Notifications.** Would need a permission we do not otherwise need; the finished
  clip opens in the Studio instead.
- **GIF, PiP camera, countdown, full-page screenshot** — v2 (§13).

## Failure modes, and where each is handled

| Failure | Handling |
|---|---|
| SW evicted mid-recording | Nothing happens. `rehydrate()` on next wake (`background.ts`). |
| Offscreen/window OOM-killed | Heartbeat stops → `isStale()` → badge `!`, session flipped to `interrupted`, recovery card. Handled on SW wake **and** by a one-shot timer armed after each live update (for the case where the SW is awake and nothing would otherwise wake it). 🔴 `findInterruptedSessions()` returns `recording`/`paused` **and `interrupted`**, so a *detected* interruption is still visible — the flip closes the "still recording" claim, it never hides the recording (audit B1). |
| Browser/machine dies | Manifest on disk still says `recording` (nothing ran to flip it) → `findInterruptedSessions()` → recovery card. ≤3 s lost. |
| Disk full | `QuotaExceededError` → `stop('quota')` → finalise (`utils/session.ts`). |
| Recorded tab closed / share ended from the browser's UI | `track.onended` → normal stop, reported as *stopped*, not an error (§5.3, §5.4). |
| Recorder window closed (Firefox) | `beforeunload` warning + `pagehide` clean stop + a `windows.onRemoved` backstop in the background. |
| streamId expired | `getUserMedia` rejects → an honest, specific message, never "Unknown error" (§10.2). |
| Second recording started while one is live | `{ok:false, code:'busy'}` — one offscreen document, one session (§5.15). |
| Encode wedges | 45 s no-progress watchdog → abort → "исходник цел" (§10.4). |
| Export fails for any reason | The source is never touched before a successful export (§5.7). |

Two bugs found and fixed during self-review, both in this codebase, both silent
data loss:

1. `seq` was allocated **after** an `await` in the chunk writer. The final chunk
   landing while the previous write was in flight would have taken the same
   sequence number and **overwritten it** — 3 s of video gone, no error anywhere.
   Now allocated synchronously, and writes are serialised through a chain that
   `stop()` drains before reporting "saved".
2. The `QuotaExceededError` handler `await`ed `stop()` **from inside** the write
   chain that `stop()` drains — a deadlock at precisely the moment the recording
   was trying to save itself. Now kicked off unawaited.

## Not verified (needs a live browser)

None of the following can be established from a build; they need real Chrome and
real Firefox, and several are the open questions from §14.2:

1. **Firefox H.264 encode** (§14.2 #4). The probe is wired and the UI reacts to it,
   but the answer *on a real Firefox* is unknown. If it returns false, Firefox
   users get WebM only — which the UI already states.
2. **Can the offscreen document get the microphone after the grant was given from a
   visible page?** (§14.2 #1). The design assumes yes (the grant is per extension
   origin) and the code degrades honestly if not: the video keeps recording without
   sound rather than the capture failing.
3. Whether Chrome shows its own capture indicator for `tabCapture`-via-offscreen (§14.2 #2).
4. Whether Chrome throttles the recorded tab when it is occluded (§14.2 #3).
5. `MediaRecorder` timestamp behaviour across `pause()`/`resume()` (§14.2 #5) — the
   duration is tracked independently (pause-aware accumulation), but whether the
   container's own timestamps develop a hole is untested.
6. Real `VideoEncoder` bitrate accuracy on screen content (§14.2 #6) — this decides
   whether 3 passes is the right default.
7. Whether Firefox honours `windows.create({focused:false})` (§14.2 #7). We pass
   `focused: true` on Firefox anyway, because the user must click inside the window
   to give `getDisplayMedia` its activation.
8. Actual platform size limits (Discord/Slack/GitHub) at release time — they are
   baked in locally, marked as possibly stale, and are user-editable.

## Repo-level follow-ups (outside `extensions/capture/`, not done here)

- **`PRIVACY.md`** needs a `capture` section: what is recorded (tab video/audio;
  microphone only on explicit opt-in), where it lives (IndexedDB in the browser
  profile), how long (until the user deletes it), where it goes (nowhere —
  `connect-src 'none'`). A privacy policy is required *even though* everything is
  local (PLAN-2 §1.4).
- **`THIRD-PARTY-NOTICES.md`** must list **mediabunny 1.50.x (MPL-2.0)**: weak
  copyleft — modifications *inside its files* must be published; linking need not.
  We do not modify it.
- `TODO.md` §I can be ticked, with the caveats in "Not verified" above.
