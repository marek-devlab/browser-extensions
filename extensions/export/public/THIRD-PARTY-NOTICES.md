# Third-Party Notices — Page Content Exporter

This extension is published by Blockaly under the MIT License. That license covers
Blockaly's own code only. The extension package also **bundles and ships** the
third-party code listed below, under the licenses stated. Nothing in Blockaly's
license grants rights over that material.

Full notices for the whole suite: <https://github.com/marek-devlab/browser-extensions/blob/main/THIRD-PARTY-NOTICES.md>

> **Scaffold note:** `write-excel-file` and `fflate` are declared as dependencies
> and reserved for the `.xlsx` writer, but the byte-generation logic is not yet
> wired (see IMPLEMENTATION.md). They are injected on demand as a second file
> (`xlsx.js`) and only when the user chooses `.xlsx` — a plain CSV export loads
> neither.

---

## write-excel-file — MIT

`.xlsx` generation uses [write-excel-file](https://github.com/catamphetamine/write-excel-file),
© catamphetamine. It is bundled and runs entirely in the browser; it is never
fetched at runtime. Chosen over SheetJS (left npm) and exceljs (abandoned Oct 2023)
per PLAN-2 §3.2.

## fflate — MIT

[fflate](https://github.com/101arrowz/fflate), © Arjun Barrett. Transitive
dependency of write-excel-file (zip container for the OOXML package); reused for
the planned v2 "images → ZIP" feature, so no new dependency appears.

## react 19, react-dom 19, scheduler — MIT

© Meta Platforms, Inc. and affiliates. <https://github.com/facebook/react>

> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify,
> merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following
> conditions:
>
> The above copyright notice and this permission notice shall be included in all copies
> or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
> PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
> HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
> OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
