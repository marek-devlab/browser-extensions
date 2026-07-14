# DNR rulesets — GENERATED

`easylist.json`, `easyprivacy.json`, `annoyances.json`, `cosmetic.json` and
`manifest.json` are produced by `npm run build:rules`
(`scripts/build-rulesets.mjs`) from [`@adguard/dnr-rulesets`]. Do not hand-edit —
re-run the build instead. `manifest.json` records each list's id, title, rule
count, regex count, licence and the build date.

## How they are produced

`@adguard/dnr-rulesets` ships prebuilt, already-converted DNR JSON **offline** in
`dist/filters/chromium-mv3/declarative/ruleset_<id>/`. The build reads those
directly (no network) and, per output list, drops AdGuard's metadata sentinel and
`redirect` rules, strips stray metadata, reassigns sequential ids and caps to a
rule budget. We do not write a filter parser (PLAN.md §1).

The canonical upstream refresh — which repopulates that same `declarative/` layout
from https://filters.adtidy.org — is:

```
npx dnr-rulesets load ./node_modules/@adguard/dnr-rulesets/dist/filters/chromium-mv3
# or, programmatically:
#   await new AssetsLoader().load('<out>', { onlyDeclarativeRulesets: true });
```

Mapping (EasyList/EasyPrivacy are folded into AdGuard's Base/Tracking Protection
filters, not shipped standalone):

- `easylist.json`   ← AdGuard Base filter (id 2), capped 20,000
- `easyprivacy.json`← AdGuard Tracking Protection (id 3), capped 9,000
- `annoyances.json` ← Cookie Notices/Popups/Other/Widgets (18,19,21,22), capped 6,000

`cosmetic.json` is a small **curated** set (`generic` + `siteSpecific`), because DNR
JSON carries no `##selector` cosmetic rules and the raw text filters that
`@adguard/tsurlfilter`'s CosmeticEngine would parse are not bundled offline.

## Why they live in `public/`

`declarative_net_request.rule_resources[].path` in the manifest resolves relative
to the **built extension root**, and the browser reads the JSON itself. WXT copies
`public/` to the root verbatim, so these files must not be bundled or transformed.

## Rule budget

Chrome **guarantees 30,000 enabled static rules per extension**. The build asserts
that the `standard` tier (easylist + easyprivacy = 29,000) fits inside it, that
combined regex ≤ 1,000, that ≤ 100 rulesets are declared and ≤ 50 enabled at once,
and fails loudly otherwise.

## Licences

- EasyList / EasyPrivacy — GPLv3 / CC-BY-SA.
- AdGuard lists — GPLv3.
- Peter Lowe's list — free for personal / non-commercial use only; commercial
  redistribution needs permission, so it is deliberately **not** bundled.
