# netblock — headed smoke checklist (the manual remainder)

> Everything else is green headless: `npm run typecheck`, both builds, `npm run
> guards`, the Node suites, `npm run e2e:netblock` (Playwright: `ui.spec.ts` +
> `integration.spec.ts`, real popup via `chrome.action.openPopup()` + raw CDP)
> and the four live engine runs (`dnr` / `page` / `debugger` / Firefox
> `webrequest`). The steps below **cannot** be automated and are the one
> remaining human gate before a store submission:
>
> - **Native permission prompt** — `permissions.request({origins})` opens a
>   browser dialog no automation can press; the suites grant the fixture origin
>   in a TEST COPY of the manifest instead (`e2e/netblock/helpers.ts`).
> - **`activeTab` on a real toolbar click** — the popup learns the host of a
>   not-yet-enabled site only through `activeTab`, which the browser grants for
>   the user's click on the action icon, never for `chrome.action.openPopup()`.
>   Under automation such a tab reads as "restricted", so §2.1 / §6.9 (`—`,
>   "Enable on <host>") are checked here.
> - **The yellow "debugging this browser" banner and its Cancel button** — the
>   infobar is browser chrome, outside every DOM a test can reach.
> - **Browser restart** — `storage.session` clearing + the §5.6 notice need a
>   real quit/relaunch (a service-worker restart is automated in
>   `integration.spec.ts` §8 and is a different thing).

## Load
1. `npm run build:netblock` → load `extensions/netblock/.output/chrome-mv3`
   unpacked at `chrome://extensions` (Developer mode on). Install warnings shown:
   "Access the page debugger backend" + "Read and change all your data on all
   websites" (from `debugger`, install-time — see `wxt.config.ts` header).
2. Start the fixture: `node -e "import('./e2e/netblock-spikes/server.mjs').then(m=>m.startServers()).then(s=>console.log(s.pageOrigin,s.apiOrigin))"`
   and open `<pageOrigin>/page.html` in a tab.

## A — Site access from the popup (§2.1, §4.1 step 1, §6.9)
1. Click the toolbar icon on the fixture tab → popup shows the host, **"The
   extension is off on this site."**, the **Enable on 127.0.0.1** button, the
   "browser will ask…" line and "Rules with Block … work without access".
2. A `dnr` block rule (e.g. the "CDN images" preset saved as-is) is listed as
   active with counter **`—`** (not `0`) while access is missing.
3. Click **Enable on 127.0.0.1** → the browser's own prompt appears → Allow.
   The popup re-renders: "✓ enabled", counters become `≈0` / `0`, the rule
   list stays. `chrome://extensions` → Details → "Site access" lists the host.
4. In the fixture tab run `fetch('/api/x')` from DevTools → the tool page
   `#/log?tab=<id>` shows the row (observation on a granted origin).
5. Remove the site in Settings → Access → ✕ → popup returns to step 1 and the
   log for that tab is empty with "No site access — the log is unavailable here."

## B — Network-level mode banner (§2.3, §2.7, §5.5, §6.4)
1. Create a rule: URL contains `/api/real500`, Response status `5xx`, action
   Network error `InternetDisconnected` → badge `dbg`.
2. Popup on the fixture tab → the rule is `○ needs Network-level mode`.
   Toggle **Network-level mode** → the consent dialog says a yellow banner will
   appear and that the banner's Cancel turns the mode off → **Turn on**.
3. The yellow infobar "Request Blocker started debugging this browser" appears
   across windows; the popup reads "▲ The debugging banner at the top is us…"
   and "Intercepted: N · rules applied: M" grows as the page fetches.
4. Press **Cancel** on the infobar → the tool page shows the assertive toast
   "Network-level mode was turned off by the browser (“canceled_by_user”)…",
   the popup switch is off, the rule is inactive again, the page's fetches pass.
5. Toggle it on again, then close the tab → the banner disappears after ≈5 s
   (Chrome's own delay); `chrome.storage.session.get('nlTabs')` in the
   service-worker console is `[]`.

## C — Browser restart (§5.6, §6.7)
1. With a stateful rule at e.g. `2/3` in the popup, quit Chrome completely and
   relaunch; reopen the fixture tab and the popup.
2. The one-shot callout **"Counters were reset after the browser restarted."**
   is shown once; the counter reads `0/3`; the log is empty (session storage,
   never disk — §7.2).
3. Session DNR rules were dropped by the browser with the restart and
   re-installed by the worker's first `apply()`: a `dnr` rule still blocks.
