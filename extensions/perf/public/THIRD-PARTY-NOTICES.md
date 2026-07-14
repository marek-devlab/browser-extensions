# Third-Party Notices — Page Performance & Network

This extension is published by Blockaly under the MIT License. That license covers
Blockaly's own code only. The extension package also **bundles and ships** the
third-party code listed below, under the licenses stated. Nothing in Blockaly's
license grants rights over that material.

Full notices for the whole suite: <https://github.com/marek-devlab/browser-extensions/blob/main/THIRD-PARTY-NOTICES.md>

---

## web-vitals 5.3.0 — Apache License 2.0

Core Web Vitals (LCP, INP, CLS, FCP, TTFB) and their attribution are measured with
[web-vitals](https://github.com/GoogleChrome/web-vitals), © Google LLC. It is bundled
inside this extension and is never fetched at runtime.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this
file except in compliance with the License. You may obtain a copy of the License at:

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied. See the License for the specific language governing
permissions and limitations under the License.

web-vitals is redistributed **unmodified**. This notice is provided to satisfy Apache-2.0
§4(d) (retention of attribution notices in redistributed works).

## react 19.2.7, react-dom 19.2.7, scheduler 0.27.0 — MIT

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

---

## Note on data transmission

The optional PageSpeed Insights audit calls Google's public PSI API
(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed`). That is a network
service, not bundled code, and it is used only when you explicitly run an audit. See the
privacy policy for what is sent.
