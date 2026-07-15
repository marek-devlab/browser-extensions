# Third-Party Notices

This repository (Blockaly browser extensions: **blur**, **adblock**, **perf**, **seo**,
**devdata**, **export**, **assets**, **whoami**, **capture**, **compose**)
is published by Blockaly under the MIT License (see [`LICENSE`](./LICENSE)).

The MIT License covers **Blockaly's own source code only**. This repository and the
extension packages built from it also redistribute third-party material that is
licensed under other terms. Those terms govern that material and are reproduced or
referenced below. Nothing in `LICENSE` grants rights over third-party material.

All version numbers and license identifiers below were verified against the `license`
field and `LICENSE` file of the installed package under `node_modules/` at the versions
resolved by `package-lock.json` (verified 2026-07-15).

---

## A. Libraries whose code is BUNDLED and SHIPPED inside an extension package

These libraries are compiled into the JavaScript that ships in the published extension
artifacts. Their notices must travel with the distributed extension.

| Package | Version | License | Ships in | Upstream |
| --- | --- | --- | --- | --- |
| `react` | 19.2.7 | MIT | all ten extensions | https://github.com/facebook/react |
| `react-dom` | 19.2.7 | MIT | all ten extensions | https://github.com/facebook/react |
| `scheduler` | 0.27.0 | MIT | all ten extensions (transitive dep of `react-dom`) | https://github.com/facebook/react |
| `web-vitals` | 5.3.0 | Apache-2.0 | perf | https://github.com/GoogleChrome/web-vitals |
| `axe-core` | 4.12.1 | MPL-2.0 | seo | https://github.com/dequelabs/axe-core |
| `mediabunny` | 1.50.8 | MPL-2.0 | capture | https://github.com/Vanilagy/mediabunny |
| `yaml` | 2.9.0 | ISC | devdata | https://github.com/eemeli/yaml |
| `papaparse` | 5.5.4 | MIT | devdata | https://github.com/mholt/PapaParse |
| `@cfworker/json-schema` | 4.1.1 | MIT | devdata | https://github.com/cfworker/cfworker |
| `json5` | 2.2.3 | MIT | devdata | https://github.com/json5/json5 |
| `jose` | 6.2.3 | MIT | devdata | https://github.com/panva/jose |
| `jsonc-parser` | 3.3.1 | MIT | devdata | https://github.com/microsoft/node-jsonc-parser |
| `write-excel-file` | 2.3.10 | MIT | export | https://github.com/catamphetamine/write-excel-file |
| `fflate` | 0.8.3 | MIT | export | https://github.com/101arrowz/fflate |
| `markdown-it` | 14.3.0 | MIT | compose | https://github.com/markdown-it/markdown-it |
| `dompurify` | 3.4.12 | MPL-2.0 OR Apache-2.0 | compose | https://github.com/cure53/DOMPurify |
| `emojibase-data` | 16.0.3 | MIT (data; emoji annotations derive from Unicode CLDR) | compose | https://github.com/milesj/emojibase |

### react / react-dom / scheduler — MIT

> MIT License
>
> Copyright (c) Meta Platforms, Inc. and affiliates.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

Full text: `node_modules/react/LICENSE`.

### web-vitals — Apache License 2.0

Copyright Google LLC. Licensed under the Apache License, Version 2.0.
Full text: https://www.apache.org/licenses/LICENSE-2.0 (also at `node_modules/web-vitals/LICENSE`).

`web-vitals` is imported by the **perf** extension (`extensions/perf/entrypoints/content.ts`)
and bundled unmodified into the content script. Apache-2.0 requires that this attribution
notice and a copy of the license accompany the distribution; §4(b) obligations regarding
modification notices do not apply because the library is used unmodified.

### axe-core — Mozilla Public License 2.0

Copyright Deque Systems, Inc. Licensed under the Mozilla Public License, Version 2.0.
Full text: https://mozilla.org/MPL/2.0/ (also at `node_modules/axe-core/LICENSE`).
axe-core's own third-party notices: `node_modules/axe-core/LICENSE-3RD-PARTY.txt`.

`axe-core` is imported by the **seo** extension (`extensions/seo/entrypoints/axe-run.ts`)
and bundled unmodified. MPL-2.0 is a **file-level** copyleft: because axe-core is used
unmodified and merely linked into a Larger Work, the MPL only requires that (a) the
axe-core source remain available under MPL-2.0 and (b) recipients be informed of that.
Blockaly does not modify any axe-core source file, so no Blockaly-authored file becomes
subject to the MPL. Source for the exact version is available at
https://github.com/dequelabs/axe-core/tree/v4.12.1 and via `npm pack axe-core@4.12.1`.

### mediabunny — Mozilla Public License 2.0

Copyright © Vanilagy. Licensed under the Mozilla Public License, Version 2.0.
Full text: https://mozilla.org/MPL/2.0/ (also at `node_modules/mediabunny/LICENSE`).

`mediabunny` is imported by the **capture** extension and bundled unmodified into
the JavaScript that ships in the package. It performs all video/audio muxing and
encoding **entirely in the browser** (WebCodecs); it is never fetched or updated
at runtime, and the exact bytes reviewed are the exact bytes that run. MPL-2.0 is
a **file-level** copyleft: because mediabunny is used unmodified and merely linked
into a Larger Work, the MPL only requires that (a) the mediabunny source remain
available under MPL-2.0 and (b) recipients be informed of that. Blockaly modifies
no mediabunny source file, so no Blockaly-authored file becomes subject to the
MPL. Source for the exact version is available at
https://github.com/Vanilagy/mediabunny and via `npm pack mediabunny@1.50.8`.

### dompurify — MPL-2.0 OR Apache-2.0 (dual)

Copyright © Dr.-Ing. Mario Heiderich, Cure53. Dual-licensed; recipients may use it
under **either** the Mozilla Public License, Version 2.0 **or** the Apache License,
Version 2.0. Full texts: https://mozilla.org/MPL/2.0/ and
https://www.apache.org/licenses/LICENSE-2.0 (also at `node_modules/dompurify/LICENSE`).

`dompurify` is imported by the **compose** extension to sanitize the HTML produced
when Markdown is rendered to a preview. It is bundled unmodified and runs entirely
in the browser; it is never fetched at runtime. Because it is used unmodified,
neither license imposes any obligation on Blockaly's own source beyond preserving
this notice and the accompanying license text.

### yaml — ISC

Copyright © Eemeli Aro. Licensed under the ISC License.
Full text: `node_modules/yaml/LICENSE`.

`yaml` is imported by the **devdata** extension for YAML parsing and serialization.
It is bundled unmodified and runs entirely in the browser; it is never fetched at
runtime.

### papaparse, json5, jose, @cfworker/json-schema, jsonc-parser (devdata) — MIT

The **devdata** extension bundles the following MIT-licensed libraries, unmodified,
all running entirely in the browser and never fetched at runtime:

- `papaparse` 5.5.4 — © Matthew Holt — CSV parsing. https://github.com/mholt/PapaParse
- `json5` 2.2.3 — © Aseem Kishore and others — JSON5 parsing. https://github.com/json5/json5
- `jose` 6.2.3 — © Filip Skokan — JWT/JWS decoding and verification, fully local. https://github.com/panva/jose
- `@cfworker/json-schema` 4.1.1 — © Jeremy Danyow — JSON Schema validation. https://github.com/cfworker/cfworker
- `jsonc-parser` 3.3.1 — © Microsoft Corporation — JSON-with-comments parsing. https://github.com/microsoft/node-jsonc-parser

The MIT license text is identical to the React notice reproduced above; a copy of
each ships in the respective `node_modules/<pkg>/LICENSE`.

### write-excel-file, fflate (export) — MIT

The **export** extension bundles the following MIT-licensed libraries, unmodified,
running entirely in the browser and never fetched at runtime:

- `write-excel-file` 2.3.10 — © catamphetamine — `.xlsx` generation. https://github.com/catamphetamine/write-excel-file
- `fflate` 0.8.3 — © Arjun Barrett — zip/deflate (the OOXML container for `.xlsx`; transitive dep of write-excel-file). https://github.com/101arrowz/fflate

### markdown-it, emojibase-data (compose) — MIT

The **compose** extension bundles, unmodified and browser-only:

- `markdown-it` 14.3.0 — © Vitaly Puzrin, Alex Kocharin — Markdown rendering. https://github.com/markdown-it/markdown-it
- `emojibase-data` 16.0.3 — © Miles Johnson — emoji **data** (MIT). The emoji annotations within it derive from the **Unicode CLDR** and remain subject to the Unicode license terms. https://github.com/milesj/emojibase

---

## B. Filter-list DATA bundled in the `adblock` extension

The **adblock** extension ships pre-converted Declarative Net Request (DNR) rulesets as
JSON data files under `extensions/adblock/public/rules/`, which WXT copies verbatim into
the built extension at `rules/`:

- `rules/easylist.json` — 20,000 rules
- `rules/easyprivacy.json` — 9,000 rules
- `rules/annoyances.json` — 6,000 rules

(`rules/cosmetic.json` is **not** third-party: it is a small, hand-curated selector list
authored by Blockaly and is covered by `LICENSE`.)

### Provenance

These files are generated offline by `extensions/adblock/scripts/build-rulesets.mjs` from
the prebuilt DNR JSON that ships inside the npm package **`@adguard/dnr-rulesets`**, at:

- **`@adguard/dnr-rulesets` version `4.1.20260710130040`** (license field: `GPL-3.0-only`)
- recorded in `extensions/adblock/public/rules/manifest.json` as `dnrRulesetsVersion`,
  build date `2026-07-10`.

AdGuard produces those DNR rulesets by converting its own text filter lists (which are in
turn built from, and incorporate, the EasyList family of lists). The mapping used by this
build — from `build-rulesets.mjs` and `manifest.json` — is:

| Shipped file | AdGuard source filter id(s) | Upstream list | License (as recorded in `manifest.json`) |
| --- | --- | --- | --- |
| `easylist.json` | 2 | AdGuard Base filter, which incorporates **EasyList** | GPL-3.0 / CC-BY-SA |
| `easyprivacy.json` | 3 | AdGuard Tracking Protection filter, which incorporates **EasyPrivacy** | GPL-3.0 / CC-BY-SA |
| `annoyances.json` | 18, 19, 21, 22 | AdGuard Annoyances: Cookie Notices, Popups, Mobile App Banners/Other, Widgets | GPL-3.0 |

EasyList and EasyPrivacy are not shipped standalone by AdGuard; they are folded into
AdGuard's Base and Tracking Protection filters, which is why the mapping above is to
AdGuard filter ids rather than to the raw EasyList files.

### What Blockaly changed

The rule *content* is **not** modified. `build-rulesets.mjs` only:

1. drops AdGuard's metadata sentinel rule,
2. drops `redirect`-action rules (their `$redirect` web-accessible resources are not bundled),
3. strips stray `metadata` keys and reassigns sequential rule `id`s,
4. truncates each list to a rule budget (20,000 / 9,000 / 6,000) to fit Chrome's
   30,000 guaranteed static-rule limit.

The shipped rules are therefore an **unmodified subset** of the AdGuard-converted rulesets
at version `4.1.20260710130040`.

### Upstream projects and licenses

- **AdGuard filter lists / `@adguard/dnr-rulesets`** — GPL-3.0-only.
  https://github.com/AdguardTeam/FiltersRegistry ·
  https://github.com/AdguardTeam/tsurlfilter/tree/master/packages/dnr-rulesets ·
  https://filters.adtidy.org
- **EasyList** — GPL-3.0 / CC-BY-SA 3.0 (dual). https://easylist.to/ ·
  https://github.com/easylist/easylist
- **EasyPrivacy** — GPL-3.0 / CC-BY-SA 3.0 (dual). https://easylist.to/ ·
  https://github.com/easylist/easylist

### ⚠️ The GPL question — stated plainly

This is redistribution of GPL-3.0-licensed **data**, not a link against GPL-licensed
program code. The honest position is:

- The rulesets are a **derivative work** of GPL-3.0-licensed filter lists (AdGuard's, and
  transitively EasyList/EasyPrivacy). They are copied into, and distributed with, the
  adblock extension package.
- GPL-3.0 §4/§5 therefore attach **to those files**: they must carry the license notice,
  they must remain available under GPL-3.0, and recipients must be told where to get them.
  This document and `extensions/adblock/public/rules/ATTRIBUTION.md` (which ships inside the
  extension) provide that notice, and the upstream source is publicly available at the links
  above at the exact recorded version.
- The MIT license on this repository **does not and cannot** relicense that data. The
  `LICENSE` file covers Blockaly's own code. The files under `rules/` remain GPL-3.0 (with
  EasyList/EasyPrivacy additionally available under CC-BY-SA 3.0).
- Blockaly's own extension code is **not** a derivative of the filter lists — it consumes
  them as data through the browser's `declarative_net_request` API, and no GPL-licensed
  program code is linked into or bundled with the extension. On that basis the GPL's
  copyleft is not propagated to Blockaly's MIT-licensed source. **This is a legal position,
  not a settled fact**; see the flag in `README`/reviewer notes and take counsel if the
  distinction matters commercially.
- Peter Lowe's list (free for personal / non-commercial use only) is deliberately **not**
  bundled — see `extensions/adblock/public/rules/README.md`.

---

## C. Build-time-only tooling (NOT redistributed)

The following are `devDependencies`. They run on a developer machine to produce the build
output and **no part of them is copied into any shipped extension package**. Their licenses
impose no obligation on the distributed artifacts.

| Package | Version | License | Role |
| --- | --- | --- | --- |
| `@adguard/dnr-rulesets` | 4.1.20260710130040 | GPL-3.0-only | Source of the prebuilt DNR JSON. **Its code is not shipped — but the ruleset *data* it provides IS; see section B.** |
| `@adguard/tsurlfilter` | 5.0.1 | GPL-3.0-only | Declared in `extensions/adblock/package.json`. **Not imported anywhere** in the adblock source (it is referenced only in a code comment in `extensions/adblock/utils/backends/webrequest.ts`), so none of its code is bundled. |
| `wxt` | 0.20.27 | MIT | Extension build framework |
| `@wxt-dev/module-react` | ^1 | MIT | WXT React module |
| `typescript` | ^7.0.2 | Apache-2.0 | Compiler |
| `@types/react`, `@types/react-dom` | ^19 | MIT (DefinitelyTyped) | Type declarations only |
| `@playwright/test` | ^1.61.1 | Apache-2.0 | E2E tests |

> **Note for reviewers:** `@adguard/tsurlfilter` is a GPL-3.0 package listed as a
> devDependency but not used. Removing it from `extensions/adblock/package.json` would
> eliminate any ambiguity about GPL code entering the build.

---

## Contact

Questions about licensing or attribution: **nikita@blockaly.com** · https://blockaly.com
