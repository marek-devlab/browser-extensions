# Asset Inspector

Point at any element on a page and see **where it came from**: the real URL the
browser loaded, which `srcset` candidate it picked and *why*, the natural size
against the displayed size, and the requests that produced it.

Everything runs locally. The extension makes **zero network requests of its own** —
not for previews, not for MIME types, not for analytics. The URLs it shows, it never
requests.

## Single purpose

Exactly one phrase: **"Find the source of any element on a page and the requests that
loaded it."**

It is an **inspector**. It has no "get the file" button, no `downloads` permission,
and no code path that fetches a resource it displays — the thumbnail is drawn from
the element the browser had *already* decoded (`canvas.drawImage`), so the preview
costs zero requests, and there is no code in the extension that can obtain the bytes
of anything.

It is also **not** a performance tool. It draws no waterfall, no time axis, and no
page-weight total. Those questions ("how fast, how heavy is the page") belong to a
different extension. This one only ever answers "what is *this element*, and where
did it come from".

## Permissions — the honest version

```
permissions: ["activeTab", "scripting", "storage", "contextMenus"]
devtools_page: devtools.html
host_permissions: []          ← none
content_scripts: []           ← none
```

| Permission | What it is actually for |
|---|---|
| `activeTab` | The inspector runs only when you ask for it — a toolbar click, `Alt+Shift+A`, or the context menu — and only on the tab you are looking at. |
| `scripting` | Injects the picker and the resource card at that moment. There is no permanent script on any site. |
| `storage` | Your preferences, and where you dragged the card. **Nothing about the pages you visit is stored** — no history, no list of inspected resources, no cache. |
| `contextMenus` | The second way in: right-click an image / video / audio → "What is this element?" |
| `devtools_page` | The optional panel. The request *initiator* (which script, which line) and the *redirect chain* exist nowhere else in the browser. |

No host permissions, no `webRequest`, no `chrome.debugger`, no persistent content
script — so no "read and change all your data on all websites" at install.

## What it shows

- **The URL the browser actually loaded** (`currentSrc`) — not what the markup asked
  for. Full, copyable, openable in a new tab.
- **Which `srcset` candidate won, and why.** The slot width from `sizes` (resolved
  with `matchMedia` and a real measurement), the DPR, the effective density of every
  candidate, and the `<picture>` `<source>` that won. If our reconstruction of the
  spec disagrees with what the browser did, *we say so first* — `currentSrc` is the
  fact, the table is the explanation.
- **Overweight**: "2400 px natural, 480 css-px displayed" — in pixels, because the
  bytes are usually not knowable.
- **The requests that loaded it**, from Resource Timing.
- **An honest card for streaming players**: a `blob:` video has no file URL at all —
  the player assembles it in memory from segments. We explain that, list the requests
  feeding it, and say whether EME is active. We do not open or parse any manifest.
- **An honest card for cross-origin frames**: we do not look inside, and we say why,
  and we offer the one thing that does work — open the frame URL in its own tab.

## What it deliberately does *not* know

Every unknown has a stated reason. There are no blank cells.

| Missing | Why |
|---|---|
| Weight, cross-origin | The server sent no `Timing-Allow-Origin`, so the browser hides the size from the page. It says **"not measured"** — never "0 KB". |
| The initiator *script* | A page can only see the initiator *type*. The script and line live in the DevTools HAR. |
| The redirect chain | Resource Timing reports only the final URL. |
| The exact MIME | Guessed from the file extension, and labelled as a guess. |
| The video codec | Only if the markup declared it — and then marked "claimed, not verified". |
| The DRM system name | Not obtainable without a script on every site. We show that EME is active, and stop there. |

The DevTools panel fills in the first three. It is a strict enhancement: without it
the card still works, it just knows less in three lines out of twenty.

## Desktop and mobile

Works on Chrome, Edge, Firefox — and on **Firefox for Android**, where there is no
right-click, no context menu and no DevTools. Everything reachable from the context
menu is also reachable from the popup, the picker selects by **tap plus a confirm
button** (there is no hover on a touchscreen), and the card is usable down to 360 px.
All of that is decided by feature detection, never by sniffing the user agent.
