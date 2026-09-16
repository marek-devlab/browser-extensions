# @blur/netcore

Network-level building blocks shared by the request-touching extensions
(`perf` today; `netblock` next — see `docs/design/netblock.md` §10.4). Like
`@blur/core` it has **no browser-API imports**: everything that needs
`chrome.*`/`browser.*` takes the API object as a parameter, so every module is
directly loadable in Node for the logic tests (`e2e/netcore/logic.test.mjs`).

| Module | What | Used by |
|---|---|---|
| `url-match.ts` | Pure URL matching: DNR `urlFilter` semantics (`\|\|`, `\|`, `^`, `*`), glob→RegExp, `contains/equals/wildcard/regex` ops, host helpers, regex safety check | netblock (rule editor «Test URL», page/webrequest engines) |
| `cdp-session.ts` | `chrome.debugger` session wrapper: attach, per-tab event routing, detach-in-finally, error normalisation | perf (`debugger-bytes.ts`), netblock (debugger engine) |

Deliberately **not** here: `extensions/adblock/utils/backends/webrequest-match.ts`.
It is a whole-host set matcher for filter lists, and it stays import-free on
purpose so `e2e/adblock/logic.test.mjs` can load it without a bundler. Its two
generic helpers (`hostOf`, `matchesSuffix`) are re-implemented here with the
same semantics and covered by the same style of test.
