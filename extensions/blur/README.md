# Content Blur

A WXT + React + TypeScript browser extension that blurs unwanted content on web
pages. Chrome (MV3) and Firefox (incl. Firefox for Android) build from the same
codebase.

**Single purpose:** _"Hide unwanted content on web pages."_ The extension blurs
only images, video, video posters/thumbnails, and text matching your patterns.
It does no network blocking and ships no rule lists.

Ad blocking is a **separate companion extension** in this monorepo. Keeping the
two apart is what satisfies the Chrome Web Store single-purpose policy — each
add-on has one narrow purpose a reviewer can write down (see `PLAN.md` §0).

## Run

From the monorepo root:

```bash
npm install
npm run dev:blur           # Chrome
npm run dev:blur:firefox   # Firefox
```

## How it works

- **Blur engine** — `DomRuleEngine` (in `@blur/core`) injects the blur stylesheet
  at `document_start` and keeps it applied through a MutationObserver, with
  viewport gating and open-shadow-root traversal.
- **Text blur** — `utils/text-blur.ts` matches your patterns with the Custom
  Highlight API where available, falling back to span wrapping.
- **Stats** — the per-tab counts (images / videos / text matches) are measured
  from the engine's own tally and reported to the background, which drives the
  badge and the popup. They can run marginally high when the min-image-size gate
  un-blurs an already-counted small image, so they are honest, not exact.
- **Reveal all** — the popup button messages the content script, which un-blurs
  every element and text match for the configured reveal window.

Shared types and the engine come from `@blur/core`.

## Permissions & privacy

Requested permissions (Chrome MV3 and Firefox):

- `storage` — save your blur settings and per-site preferences locally.
- `activeTab` — act on the tab you are currently viewing when you invoke the extension.
- `contextMenus` — right-click "Blur this / Always blur images here" actions (no host or network access).
- **Host access via an `<all_urls>` content script (`document_start`)** — standing,
  install-time access to every site: this is what produces the "read and change all
  your data on all websites" install warning. Blurring is only useful if it happens
  before content is painted, so the script must already be present when a page opens.
  There is no `optional_host_permissions` and nothing is requested at runtime — the
  content script itself injects the block-first stylesheet, so no `scripting`
  permission is needed either.

Keyboard shortcuts use the `commands` key, which grants no extra permission.

Everything runs locally: what you blur and your settings never leave your device.
No analytics, no tracking, no remote code, no network requests. See the suite
privacy policy at [`../../PRIVACY.md`](../../PRIVACY.md).
