# Third-party notices — Data Format Toolkit

Every dependency below is bundled **locally** into the extension package. The
extension loads **no remote code** and makes **no network requests** of any kind.

| Package | Version | Licence | Used for |
|---|---|---|---|
| `jsonc-parser` | 3.3.x | MIT | Error-tolerant JSON/JSONC parsing with token offsets (exact number spelling, parse-error positions) |
| `json5` | 2.2.x | MIT | JSON5 parsing and serialisation |
| `yaml` (eemeli) | 2.9.x | ISC | YAML ↔ JSON |
| `papaparse` | 5.5.x | MIT | CSV parsing and serialisation |
| `jose` | 6.2.x | MIT | JWT signature verification via WebCrypto (verify only; no network, no JWKS fetch) |
| `@cfworker/json-schema` | 4.x | MIT | JSON Schema validation without `eval`/`new Function` (required under MV3 CSP) |
| `react`, `react-dom` | 19.x | MIT | UI |

XML is handled by the browser's native `DOMParser`/`XMLSerializer` — no library.
The syntax highlighter, the tree virtualiser and the JWT decoder are hand-written
(no highlight.js, no Prism, no CodeMirror).

Full licence texts ship with each package inside `node_modules` in the source
archive submitted to AMO.

## MIT License (jsonc-parser, json5, papaparse, jose, @cfworker/json-schema, react, react-dom)

```
Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## ISC License (yaml)

```
Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```
