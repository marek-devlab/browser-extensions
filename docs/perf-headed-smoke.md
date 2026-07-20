# perf — headed smoke checklist (single human gate)

> Everything in `extensions/perf` is green headless: `wxt build` (Chrome+Firefox),
> `tsc --noEmit`, and `npm run e2e:perf` (14/14). The two paths below **cannot** be
> exercised by the automated suite and are the one remaining human pre-submit step:
>
> - **`chrome.debugger` / CDP exact-bytes** — Playwright is itself a CDP client, so
>   our own `chrome.debugger.attach` conflicts with it under automation (the exact
>   "DevTools already attached" branch). A real, non-automated browser is required.
> - **DevTools panel render** — a `devtools_page` panel is not a normal tab, so no
>   browser-automation tool can open the real DevTools UI and drive it.
>
> Code for both paths was reviewed statically this cycle and is sound (manifest
> `optional_permissions`/`optional_host_permissions` back every runtime request;
> the CDP path arms its load signal before reload, bypasses cache, detaches in
> `finally`, and refuses to present an empty capture as "exact 0 B"). This file is
> the manual confirmation that they behave in a live browser.

## Load
1. `npm run build:perf` → load `extensions/perf/.output/chrome-mv3` unpacked at
   `chrome://extensions` (Developer mode on).

## A — PSI panel (DevTools)
1. Open DevTools on any public page → **Page Performance** panel → PSI section.
2. The URL field is **pre-filled** with the inspected page's URL and is **editable**.
3. Type a URL with a query string → the **"these params may contain secrets"** warning
   and the **"domain and path only"** button appear; clicking it strips `?`/`#`.
4. First run shows the **disclosure gate** (URL is sent to Google, link to Google's
   policy). Accept → a **"Revoke consent"** link appears; clicking it re-shows the gate.
5. Run an audit on a real public URL → host-permission prompt for `www.googleapis.com`
   appears once (runtime, on the click), then score + CWV cards render. `—` (not `0`)
   shows when a score is absent.
6. localhost / a private IP is refused **before** any network call.

## B — Exact bytes (CDP, popup)
1. Open the **popup** on a content-heavy tab, trigger **exact page weight**.
2. The `debugger` permission prompt appears once; granting it shows the browser's
   **non-dismissable "extension is debugging this browser"** banner during the measure.
3. The page reloads (cache bypassed), the total settles, the banner **clears** when the
   measure finishes (detach), and the number is labelled as measured/exact.
4. With **DevTools already open** on that tab, the trigger fails with the clear
   "close DevTools, only one debugger may attach" message — no silent hang.
5. Firefox build: the exact-bytes trigger is **absent**, and the message path honestly
   reports it as unavailable (no fabricated total).
