# Markdown Workbench (`@blur/compose`)

> Write and format text before pasting — a Markdown composer for bug reports,
> GitLab and GitHub. Emoji, checkboxes, `<details>`, tables; in-editor find &
> replace, Cyrillic→Latin transliteration and a character counter. **100% local,
> zero network, zero telemetry.**

Extension #10 of the family (PLAN.md (Часть II) §6, §10.6). Built on WXT 0.20 + React 19 +
TypeScript, MV3 (Chrome) / MV2 (Firefox). Shares the design system in
[`@blur/ui`](../../packages/ui). Design doc:
[`docs/design/compose.md`](../../docs/design/compose.md).

## Status: feature-complete

The domain logic is real — the scaffold's mocks are gone. Preview, the seven
platform converters, the regex worker, the five transliteration standards, the
grapheme counter, the emoji picker, drafts/history and export/import all work.
See [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) for the security decisions, what
is deliberately deferred, and the verification that was run (XSS suite, ReDoS
containment, both manifests).

## Surfaces

- **Side panel** (primary, desktop) — write a bug report while looking at the
  page. Chrome `side_panel`, Firefox `sidebar_action`. Not a popup.
- **Workbench** — the same editor full-page, for long documents and a wide split.
  ⚠️ **On Firefox for Android this is the only surface there is**: Android Firefox
  has no sidebar, so the toolbar action feature-detects and opens this page in a
  tab instead. (Chrome for Android has no extensions at all.)
- **Options** — theme, default target platform, transliteration standard, editor
  settings, counter fields and limits, regex timeout, export/import/clear.
- **Context menu** — one item, "Add selection to draft" (+ "…as quote").
- **Toolbar action** — opens the side panel (or the Workbench tab on mobile).

The regex find & replace, transliterator and counter are **tabs of the one
editor**, not separate tools — they have no icon, popup, command or menu of their
own (single-purpose rule, design §1.1).

## What it does

- **One source of truth: the Markdown draft.** Conversion happens only on output,
  so switching target platform is lossless.
- **Target platforms**: GitHub, GitLab, Jira wiki markup, Slack mrkdwn, Telegram
  MarkdownV2 (with its brutal escaping), HTML, plain text. Anything a platform
  cannot express degrades *with the text preserved*, and you are shown exactly
  what will change **before** you copy.
- **Copy as HTML** puts `text/html` **and** `text/plain` on the clipboard in one
  `ClipboardItem`: formatting lands in Google Docs, clean Markdown lands in a
  plain text field.
- **Find & replace with regex** runs in a Web Worker with a timeout — a
  catastrophic-backtracking pattern gets its thread killed instead of freezing
  the editor.
- **Transliteration** in five standards, because they genuinely disagree:
  `Щербаков, Юлия` → `Shcherbakov, Iuliia` (passport/ICAO) · `Shcherbakov, Yuliya`
  (BGN/PCGN) · `Ŝerbakov, Ûliâ` (ISO 9) · `Shherbakov, Yuliya` (GOST 7.79-B) ·
  `shcherbakov-yuliya` (slug, for git branches and heading anchors).
- **A counter that is not lying to you**: `"👍".length === 2` and
  `"🇺🇦".length === 4`, so it counts graphemes with `Intl.Segmenter` and shows
  UTF-16, UTF-8 bytes, words and lines *with their units* next to limit presets
  (commit 50/72, branch 63, X 280, meta description 160).
- **Bug-report templates** and an "insert environment" button (browser, OS,
  screen, timezone, and the page URL) — assembled locally, inserted into your
  draft, sent nowhere.

## Develop

```bash
npm run dev            # Chrome (MV3)
npm run dev:firefox    # Firefox (MV2)
npm run compile        # tsc --noEmit
```

## Security

The preview injects HTML into a privileged extension page that can reach
`chrome.*` and your other drafts — an XSS there is extension compromise, not a
defacement. So the pipeline has exactly one string→DOM point:

```
markdown-it (html:true, linkify:false)
  → HTML string (treated as hostile)
  → DOMPurify: explicit allow-list, RETURN_DOM_FRAGMENT
  → previewEl.replaceChildren(fragment)   // nodes, never a string
  → inside a CLOSED Shadow DOM
```

`innerHTML`, `dangerouslySetInnerHTML`, `eval` and `new Function` appear nowhere
in the codebase. Link schemes are restricted to `https:`, `http:` and `mailto:`;
the `style` attribute is stripped (it is the clickjacking primitive); `<input>` is
forced to a disabled checkbox.

## Privacy

No network access is even possible: no host permissions, and the extension-page
CSP ships `connect-src 'none'` — fetch, XHR and WebSockets are blocked by the
browser, not by a promise. Drafts and prefs live in `storage.local` (never
`storage.sync`, whose 8 KB per-item cap would silently truncate a long bug
report). Cross-device transfer is Export / Import. No analytics, no AI, no remote
code (design §7.4, §11).
