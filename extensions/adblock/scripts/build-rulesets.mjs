/**
 * Build the bundled DNR rulesets from `@adguard/dnr-rulesets`.
 *
 * Run with `npm run build:rules`. Produces `public/rules/{easylist,easyprivacy,
 * annoyances}.json`, a curated `public/rules/cosmetic.json`, and a generated
 * `public/rules/manifest.json` recording each list's id, rule count and build date.
 *
 * SOURCE: `@adguard/dnr-rulesets` ships prebuilt, already-converted DNR JSON
 * OFFLINE inside `dist/filters/chromium-mv3/declarative/ruleset_<id>/`. We read
 * those directly, so this build needs no network. The canonical upstream refresh
 * is `npx dnr-rulesets load <out>` (CLI) or `new AssetsLoader().load(out)` (API),
 * which repopulate that same layout from https://filters.adtidy.org.
 *
 * We DO NOT write a filter parser (PLAN.md §1) — AdGuard already converted the
 * EasyList/EasyPrivacy/AdGuard syntax into DNR rules; we only select, clean and
 * budget them.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'rules');

/* ---- Hard platform limits (Chrome, PLAN.md §4.1) — asserted below ---- */
const GUARANTEED_STATIC_RULES = 30_000; // per-extension guaranteed enabled static rules
const GLOBAL_STATIC_RULES = 300_000; // shared across all installed extensions (best-effort)
const MAX_STATIC_RULESETS = 100; // declared
const MAX_ENABLED_STATIC_RULESETS = 50; // enabled at once
const MAX_REGEX_RULES = 1_000;

/**
 * Rule-id watershed that lets the popup's counter tell a genuine BLOCK from an
 * exception at runtime. `getMatchedRules()` (the only per-tab signal Chromium
 * gives us) reports a matched rule's ruleset + id but NOT its action, so a static
 * `allow`/`allowAllRequests` exception matching looked identical to a block and
 * inflated "~N Blocked" (easylist alone carries ~3,000 `allow` rules). We assign
 * every non-block rule an id at or above this base and every block rule one
 * below it, so `matched-rules.ts` can count blocks only. See utils/matched-rules.ts.
 */
const NON_BLOCK_RULE_ID_BASE = 1_000_000;

/**
 * Output list → AdGuard source filter ids + a per-list cap.
 * EasyList/EasyPrivacy are folded into AdGuard's Base/Tracking Protection filters
 * (AdGuard does not ship them standalone). The caps keep the STANDARD tier
 * (easylist + easyprivacy) inside the 30k guarantee: 20,000 + 9,000 = 29,000.
 */
const LISTS = [
  {
    id: 'easylist',
    title: 'EasyList (AdGuard Base filter)',
    sourceIds: [2],
    cap: 20_000,
    license: 'GPL-3.0 / CC-BY-SA',
    enabledAt: ['standard', 'aggressive'],
  },
  {
    id: 'easyprivacy',
    title: 'EasyPrivacy (AdGuard Tracking Protection filter)',
    sourceIds: [3],
    cap: 9_000,
    license: 'GPL-3.0 / CC-BY-SA',
    enabledAt: ['standard', 'aggressive'],
  },
  {
    id: 'annoyances',
    title: 'AdGuard Annoyances (cookie notices, popups, widgets)',
    sourceIds: [18, 19, 21, 22],
    cap: 6_000,
    license: 'GPL-3.0',
    enabledAt: ['aggressive'],
  },
];

const STANDARD_LIST_IDS = new Set(['easylist', 'easyprivacy']);

function resolveDeclarativeDir() {
  // The package exposes only import-only, subpath-restricted `exports`, so resolve
  // its main entry via the ESM resolver and walk up to the `dist/` root.
  const mainEntry = fileURLToPath(import.meta.resolve('@adguard/dnr-rulesets')); // .../dist/lib/index.js
  const distRoot = dirname(dirname(mainEntry)); // .../dist
  const dir = join(distRoot, 'filters', 'chromium-mv3', 'declarative');
  if (!existsSync(dir)) {
    fail(
      `AdGuard rulesets not found at:\n  ${dir}\n\n` +
        `The prebuilt DNR JSON ships inside @adguard/dnr-rulesets. If it is absent,\n` +
        `regenerate it offline with the package's own loader:\n\n` +
        `  npx dnr-rulesets load ./node_modules/@adguard/dnr-rulesets/dist/filters/chromium-mv3\n\n` +
        `or programmatically:\n\n` +
        `  import { AssetsLoader } from '@adguard/dnr-rulesets';\n` +
        `  await new AssetsLoader().load('<out>', { onlyDeclarativeRulesets: true });\n\n` +
        `Placeholders in public/rules/ were left untouched.`,
    );
  }
  return dir;
}

function sourcePath(dir, id) {
  return join(dir, `ruleset_${id}`, `ruleset_${id}.json`);
}

/**
 * Clean one AdGuard DNR ruleset into plain Chrome-valid rules:
 * - drop the sentinel rule that carries AdGuard's `metadata` blob,
 * - drop `redirect` rules (they reference $redirect web-accessible resources we
 *   do not bundle, so they would fail at load),
 * - drop `modifyHeaders` rules. Chrome treats them as an "unsafe" action that
 *   fires ONLY on origins the extension holds a GRANTED host permission for.
 *   Host access here is `optional_host_permissions` (not granted by default), so
 *   in a static ruleset these rules are silently inert on a normal install — a
 *   piece of protection that never runs and that inflated `unsafeCount`. Dropping
 *   them (like `redirect`) keeps the shipped set to what actually fires.
 * - strip `id` (reassigned later, unique per output ruleset) and any stray `metadata`.
 */
function cleanRules(rawArr) {
  const out = [];
  for (const r of rawArr) {
    if (!r || typeof r !== 'object') continue;
    if ('metadata' in r) continue;
    const action = r.action;
    if (!action || typeof action.type !== 'string') continue;
    if (action.type === 'redirect' || action.type === 'modifyHeaders') continue;
    const { id: _id, metadata: _m, ...rest } = r;
    out.push(rest);
  }
  return out;
}

function countRegex(rules) {
  let n = 0;
  for (const r of rules) if (r.condition && typeof r.condition.regexFilter === 'string') n += 1;
  return n;
}

function countBlock(rules) {
  let n = 0;
  for (const r of rules) if (r.action && r.action.type === 'block') n += 1;
  return n;
}

function fail(msg) {
  console.error(`\n[build-rulesets] FAILED\n\n${msg}\n`);
  process.exit(1);
}

async function main() {
  const dir = resolveDeclarativeDir();
  let getVersion = () => 'unknown';
  let getVersionTimestampMs = () => Date.now();
  try {
    ({ getVersion, getVersionTimestampMs } = await import('@adguard/dnr-rulesets/utils'));
  } catch {
    // utils entry optional; fall back to a placeholder version + current time.
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const built = [];
  for (const list of LISTS) {
    let merged = [];
    for (const sid of list.sourceIds) {
      const p = sourcePath(dir, sid);
      if (!existsSync(p)) fail(`Missing source ruleset for id ${sid}: ${p}`);
      const raw = JSON.parse(readFileSync(p, 'utf8'));
      if (!Array.isArray(raw)) fail(`Source ruleset ${p} is not a JSON array.`);
      merged = merged.concat(cleanRules(raw));
    }

    const sliced = merged.slice(0, list.cap);
    // Block rules get ids 1..B; every non-block (allow/allowAllRequests) rule gets
    // an id >= NON_BLOCK_RULE_ID_BASE, so the runtime counter can exclude
    // exceptions from "~N Blocked" (see the constant's doc + matched-rules.ts).
    let blockId = 0;
    let nonBlockId = NON_BLOCK_RULE_ID_BASE;
    const capped = sliced.map((r) => ({
      id: r.action && r.action.type === 'block' ? (blockId += 1) : (nonBlockId += 1),
      ...r,
    }));
    const regexCount = countRegex(capped);
    const blockCount = countBlock(capped);

    // Honest truncation (V3): the AdGuard source is larger than the per-list cap,
    // so `slice` drops the tail. Say how much rather than degrade silently — this
    // is a documented subset of AdGuard Base, not the full upstream filter.
    const droppedByCap = merged.length - sliced.length;
    if (droppedByCap > 0) {
      console.warn(
        `[build-rulesets] ${list.id}: capped at ${list.cap} rules — dropped ${droppedByCap} ` +
          `of ${merged.length} source rules (${Math.round((sliced.length / merged.length) * 100)}% kept). ` +
          `This is a deliberate subset (Chrome's ${GUARANTEED_STATIC_RULES}-rule guarantee), not the full list.`,
      );
    }

    writeFileSync(join(OUT_DIR, `${list.id}.json`), JSON.stringify(capped));
    built.push({
      id: list.id,
      title: list.title,
      ruleCount: capped.length,
      blockCount,
      droppedByCap,
      regexCount,
      // Static modifyHeaders/redirect are dropped in cleanRules, so nothing
      // "unsafe" ships in a static ruleset any more.
      unsafeCount: 0,
      license: list.license,
      enabledAt: list.enabledAt,
      sourceIds: list.sourceIds,
    });
    console.log(
      `[build-rulesets] ${list.id}: ${capped.length} rules ` +
        `(${blockCount} block, ${regexCount} regex) from AdGuard filter(s) ${list.sourceIds.join(', ')}`,
    );
  }

  /* ---- Assertions against the Chrome guarantees ---- */
  const standard = built.filter((b) => STANDARD_LIST_IDS.has(b.id));
  const standardRules = standard.reduce((s, b) => s + b.ruleCount, 0);
  const standardRegex = standard.reduce((s, b) => s + b.regexCount, 0);

  if (standardRules > GUARANTEED_STATIC_RULES) {
    fail(
      `Standard tier is ${standardRules} rules, exceeding the ${GUARANTEED_STATIC_RULES} ` +
        `guaranteed enabled static rules. Lower the caps in LISTS.`,
    );
  }

  // AGGRESSIVE tier enables everything (easylist + easyprivacy + annoyances). It
  // deliberately exceeds the 30,000 per-extension GUARANTEE and draws on the
  // shared 300,000-rule GLOBAL pool — which is best-effort, not guaranteed. We
  // HARD-FAIL only if it cannot fit even the global pool; otherwise we WARN so the
  // overflow is a documented, deliberate choice rather than a silent surprise. At
  // runtime DnrBackend.reconcile() catches an `updateEnabledRulesets` rejection
  // (pool exhausted by other extensions) and the options "Filter lists" panel
  // renders the over-budget warning, so the user is never left with a level that
  // silently does nothing.
  const aggressiveRules = built
    .filter((b) => b.enabledAt.includes('aggressive'))
    .reduce((s, b) => s + b.ruleCount, 0);
  if (aggressiveRules > GLOBAL_STATIC_RULES) {
    fail(
      `Aggressive tier is ${aggressiveRules} rules, exceeding even the shared ` +
        `${GLOBAL_STATIC_RULES} global static-rule pool. Lower the caps in LISTS.`,
    );
  }
  if (aggressiveRules > GUARANTEED_STATIC_RULES) {
    console.warn(
      `[build-rulesets] NOTE: aggressive tier is ${aggressiveRules} rules, over the ` +
        `${GUARANTEED_STATIC_RULES} per-extension guarantee. The overflow draws on the ` +
        `best-effort ${GLOBAL_STATIC_RULES} global pool; enabling it can fail if other ` +
        `extensions have exhausted that pool (handled at runtime + surfaced in options).`,
    );
  }
  if (standardRegex > MAX_REGEX_RULES) {
    fail(`Standard tier has ${standardRegex} regex rules, exceeding MAX_REGEX_RULES (${MAX_REGEX_RULES}).`);
  }
  if (built.length > MAX_STATIC_RULESETS) {
    fail(`Declared ${built.length} rulesets, exceeding MAX_NUMBER_OF_STATIC_RULESETS (${MAX_STATIC_RULESETS}).`);
  }
  for (const level of ['standard', 'aggressive']) {
    const enabled = built.filter((b) => b.enabledAt.includes(level)).length;
    if (enabled > MAX_ENABLED_STATIC_RULESETS) {
      fail(`Level ${level} enables ${enabled} rulesets, exceeding MAX_NUMBER_OF_ENABLED_STATIC_RULESETS.`);
    }
  }

  writeCosmetic();

  const buildDate = new Date(getVersionTimestampMs()).toISOString().slice(0, 10);
  const manifest = {
    generatedAt: new Date().toISOString(),
    buildDate,
    dnrRulesetsVersion: getVersion(),
    guaranteedStaticRules: GUARANTEED_STATIC_RULES,
    maxRegexRules: MAX_REGEX_RULES,
    standardRuleBudget: standardRules,
    lists: built,
  };
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(
    `[build-rulesets] standard tier ${standardRules}/${GUARANTEED_STATIC_RULES} rules, ` +
      `${standardRegex}/${MAX_REGEX_RULES} regex. manifest.json written. Build date ${buildDate}.`,
  );
}

/**
 * Curated cosmetic selectors. DNR JSON carries no `##selector` cosmetic rules and
 * the raw AdGuard text filters (which @adguard/tsurlfilter's CosmeticEngine would
 * parse) are not bundled offline, so this small hand-picked set stands in.
 * `standard` uses `siteSpecific` only; `aggressive` adds `generic` (PLAN.md §4.5).
 */
function writeCosmetic() {
  const cosmetic = {
    generic: [
      '.ad',
      '.ads',
      '.adsbox',
      '.ad-banner',
      '.advertisement',
      '[id^="google_ads_"]',
      '[id^="div-gpt-ad"]',
      'ins.adsbygoogle',
      'iframe[src*="doubleclick.net"]',
      'iframe[src*="googlesyndication.com"]',
    ],
    siteSpecific: {
      'youtube.com': ['ytd-display-ad-renderer', '#player-ads', 'ytd-ad-slot-renderer'],
      'twitch.tv': ['.video-player__container--ads'],
      'reddit.com': ['shreddit-comments-page-ad', '[data-testid="ad-post"]'],
    },
  };
  writeFileSync(join(OUT_DIR, 'cosmetic.json'), JSON.stringify(cosmetic, null, 2));
  const bytes = statSync(join(OUT_DIR, 'cosmetic.json')).size;
  console.log(`[build-rulesets] cosmetic.json written (${bytes} bytes, curated).`);
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
