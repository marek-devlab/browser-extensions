# SEO & Accessibility Auditor

Inspect a page's meta tags, headings, structured data, social preview, link
profile, indexability, and accessibility issues — from a DevTools panel and an
at-a-glance toolbar popup. Everything runs locally in your browser; **nothing is
ever sent anywhere.**

## Single purpose

Its purpose is exactly one phrase: **"Audit page markup and accessibility."**

It ships as its own extension (not folded into the performance toolkit) because
of the Chrome Web Store single-purpose policy, and so its manifest stays trivially
reviewable — no `debugger` (CDP), no `webRequest`.

## Permissions — the honest version

```
permissions: ['storage']
content_scripts: [{ matches: ['<all_urls>'], run_at: 'document_idle' }]
```

The only API permission is `storage` (it caches the last report and your UI
prefs). **But be clear about the content script:** it is declared with
`matches: ['<all_urls>']`, which is *standing* access to the DOM of every site
you visit — that is what triggers the "read your data on all websites" warning at
install. This is deliberate:

- The extension reads page markup (meta tags, headings, links, JSON-LD, …) to
  analyze it. That needs to see the page.
- Both the SEO report and the accessibility audit run **through that already-
  injected content script** (via `tabs.sendMessage`), which is exactly why the
  extension needs neither `activeTab` nor `scripting`, and why the DevTools panel's
  "Run audit" button works with no extra gesture.

It reads the DOM only; it never writes to the page, and it never transmits
anything off the device. `robots.txt` / `sitemap.xml` / `X-Robots-Tag` checks use
plain **same-origin** `fetch` from the page — no cross-origin access, no extra
permission.

## Run it

From the repo root:

```bash
npm run dev:seo            # Chrome
npm run dev:seo:firefox    # Firefox
npm run build:seo          # production build
```

## Open the panel

The full report lives in a DevTools panel:

1. Open DevTools with **F12** (or Cmd/Ctrl+Shift+I).
2. Select the **"SEO & A11y"** tab.

The toolbar **popup** shows the headline verdict (meta presence, SEO error /
warning counts, a11y issue counts by impact) without DevTools open.

## Accessibility audit & axe-core

The accessibility audit uses
[**axe-core**](https://github.com/dequelabs/axe-core) (**MPL-2.0**). axe-core is
**bundled** with the extension and runs entirely in the browser — it is **never
fetched at runtime**, because MV3 bans remote code.

Because axe-core is ~550 kB, it is **code-split into its own chunk**
(`axe-run.js`) and kept out of every always-on path — the popup, the background,
and the always-on content script. It is injected into the page (and executed)
**only** when you press "Run audit", exactly how axe DevTools and Lighthouse run
axe. Verify with a production build: `content-scripts/content.js` is ~12 kB and
contains no axe engine code; all ~584 kB of it lives in `axe-run.js`, which is
loaded on demand.

## Report export

Both the panel and the popup can copy the full report to the clipboard as **JSON**
or **Markdown** ("Copy JSON" / "Copy Markdown").

## Structure

```
entrypoints/
  background.ts      # message router → SeoProtocol; thin relay to the content script
  content.ts         # always-on DOM reader (document_idle); injects axe on demand
  axe-run.ts         # on-demand, web-accessible axe-core runner (MAIN world)
  devtools.html      # DevTools page — registers the panel
  devtools/main.ts   # panels.create('SEO & A11y', …)
  panel/             # DevTools panel UI: SEO + Accessibility tabs
  popup/             # toolbar at-a-glance card
utils/
  checks.ts          # pure helpers + SeoReportEx (links/wordcount) composing type
  extract-seo.ts     # reads meta/headings/links/word count off the DOM
  indexability.ts    # same-origin robots.txt / sitemap.xml / X-Robots-Tag probes
  export.ts          # JSON / Markdown serialisers for the copy buttons
  a11y.ts            # axe.run → A11yReport mapping (imported only by axe-run.ts)
  storage.ts         # sync:panelPrefs + local:lastReport (versioned)
```

### Why `document_idle` in the content script

Unlike the blur extension (which runs at `document_start` to beat first paint),
this reads the **final, settled** DOM. Structured data, `og:` tags, and meta
descriptions are frequently injected by frameworks after first paint, so reading
too early would miss them.

### Storage split

Preferences go in `sync` (100 KB total / 8 KB per item / 512 items, and it fails
hard on exceed). Cached reports — which can be large — go in `local` (10 MB).
