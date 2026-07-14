# Third-Party Notices — Markdown Workbench

This extension is published by Blockaly under the MIT License. That license covers
Blockaly's own code only. The extension package also **bundles and ships** the
third-party code listed below, under the licenses stated. Nothing in Blockaly's
license grants rights over that material. Nothing here is fetched at runtime —
the extension makes no network requests.

> ⚠️ SCAFFOLD PHASE: the libraries below are declared as dependencies but their
> logic is still stubbed (see IMPLEMENTATION.md). Confirm the exact bundled
> versions and finalise these notices before release. In particular, add the
> emojibase-data **CC-BY-4.0** data-license line once the emoji set is wired
> (design §12).

Full notices for the whole suite: <https://github.com/marek-devlab/browser-extensions/blob/main/THIRD-PARTY-NOTICES.md>

---

## markdown-it 14.x — MIT

Markdown parser. © Vitaly Puzrin, Alex Kocharin. <https://github.com/markdown-it/markdown-it>
Bundled for preview rendering and the platform converters. Redistributed unmodified.

## DOMPurify 3.x — Apache-2.0 OR MPL-2.0 (dual)

HTML sanitizer. © Cure53. <https://github.com/cure53/DOMPurify>
The preview security boundary (design §7). Redistributed unmodified. Under MPL-2.0
§3.2, the unmodified source for the bundled version is available at the URL above.

## emojibase-data 16.x — MIT (code) / CC-BY-4.0 (emoji data)

Emoji shortcodes/metadata. © Miles Johnson. <https://github.com/milesj/emojibase>
Loaded lazily in a separate chunk (design §10.2). The emoji DATA is CC-BY-4.0 —
finalise attribution here when wired.

## react 19.x, react-dom 19.x — MIT

© Meta Platforms, Inc. and affiliates. <https://github.com/facebook/react>
See the full MIT text in any sibling extension's notices.
