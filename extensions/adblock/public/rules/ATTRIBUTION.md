# Attribution — bundled filter rules

The files `easylist.json`, `easyprivacy.json` and `annoyances.json` in this directory are
third-party filter-list **data** redistributed by Blockaly. They are **not** covered by the
extension's MIT license — they remain under the licenses below.

They are an unmodified subset of the pre-converted Declarative Net Request rulesets shipped
in **`@adguard/dnr-rulesets` v4.1.20260710130040** (build date 2026-07-10; see
`manifest.json`). Blockaly only removed AdGuard's metadata sentinel and `redirect` rules,
reassigned rule ids, and truncated each list to a rule budget. Rule content is unchanged.

| File | AdGuard filter id(s) | Upstream list | License |
| --- | --- | --- | --- |
| `easylist.json` | 2 | AdGuard Base filter (incorporates EasyList) | GPL-3.0 / CC-BY-SA 3.0 |
| `easyprivacy.json` | 3 | AdGuard Tracking Protection filter (incorporates EasyPrivacy) | GPL-3.0 / CC-BY-SA 3.0 |
| `annoyances.json` | 18, 19, 21, 22 | AdGuard Annoyances (Cookie Notices, Popups, Other, Widgets) | GPL-3.0 |

## Upstream sources

- AdGuard filter lists — GPL-3.0-only
  - https://github.com/AdguardTeam/FiltersRegistry
  - https://github.com/AdguardTeam/tsurlfilter/tree/master/packages/dnr-rulesets
  - https://filters.adtidy.org
- EasyList — GPL-3.0 / CC-BY-SA 3.0 — https://easylist.to/ · https://github.com/easylist/easylist
- EasyPrivacy — GPL-3.0 / CC-BY-SA 3.0 — https://easylist.to/ · https://github.com/easylist/easylist

`cosmetic.json` is authored by Blockaly and is covered by the extension's MIT license.

Full notices for everything the Blockaly extensions redistribute: `THIRD-PARTY-NOTICES.md`
in the source repository. Contact: nikita@blockaly.com
