import type { AdBlockExtensionSettings } from '@blur/core';
import type {
  AdBlockBackup,
  AdBlockSiteConfigX,
  CustomFilterEntry,
  CustomFilters,
  StoredFilter,
} from './adblock-types';

/**
 * PURE validation/normalization of an untrusted backup document (feature §4),
 * with NO storage or `@blur/core` runtime import, so it can be unit tested in
 * Node. The storage-touching export/apply live in `backup.ts`.
 *
 * Defaults are inlined (not imported from `@blur/core`) to keep this module free
 * of any runtime dependency; they mirror `DEFAULT_ADBLOCK_SETTINGS`.
 */
const FALLBACK_SETTINGS: AdBlockExtensionSettings = {
  enabled: true,
  adblock: {
    level: 'standard',
    blockAds: true,
    blockTrackers: true,
    stripTrackingParams: true,
    blockAnnoyances: false,
  },
  allowlist: [],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

/**
 * Validate + normalize untrusted JSON into an `AdBlockBackup`. Throws with a
 * human-readable reason on malformed top-level JSON, so the UI never writes
 * garbage into storage. Unknown/missing pieces fall back to safe defaults rather
 * than failing the whole import.
 */
export function parseBackup(raw: string): AdBlockBackup {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Not valid JSON.');
  }
  if (!isRecord(data)) throw new Error('Expected a JSON object.');
  return {
    version: 1,
    settings: normalizeSettings(data['settings']),
    siteConfigs: normalizeSiteConfigs(data['siteConfigs']),
    customFilters: normalizeCustomFilters(data['customFilters']),
  };
}

export function normalizeSettings(v: unknown): AdBlockExtensionSettings {
  if (!isRecord(v)) return FALLBACK_SETTINGS;
  const ab = isRecord(v['adblock']) ? v['adblock'] : {};
  const level = ab['level'];
  const allow = v['allowlist'];
  return {
    enabled: typeof v['enabled'] === 'boolean' ? v['enabled'] : FALLBACK_SETTINGS.enabled,
    adblock: {
      level:
        level === 'off' || level === 'standard' || level === 'aggressive'
          ? level
          : FALLBACK_SETTINGS.adblock.level,
      blockAds:
        typeof ab['blockAds'] === 'boolean'
          ? ab['blockAds']
          : FALLBACK_SETTINGS.adblock.blockAds,
      blockTrackers:
        typeof ab['blockTrackers'] === 'boolean'
          ? ab['blockTrackers']
          : FALLBACK_SETTINGS.adblock.blockTrackers,
      stripTrackingParams:
        typeof ab['stripTrackingParams'] === 'boolean'
          ? ab['stripTrackingParams']
          : FALLBACK_SETTINGS.adblock.stripTrackingParams,
      blockAnnoyances:
        typeof ab['blockAnnoyances'] === 'boolean'
          ? ab['blockAnnoyances']
          : FALLBACK_SETTINGS.adblock.blockAnnoyances,
    },
    allowlist: isStringArray(allow) ? allow : [],
  };
}

export function normalizeSiteConfigs(v: unknown): Record<string, AdBlockSiteConfigX> {
  const out: Record<string, AdBlockSiteConfigX> = {};
  if (!isRecord(v)) return out;
  for (const [host, cfg] of Object.entries(v)) {
    if (!isRecord(cfg)) continue;
    const entry: AdBlockSiteConfigX = { hostname: host };
    if (typeof cfg['enabled'] === 'boolean') entry.enabled = cfg['enabled'];
    if (typeof cfg['disableCosmetic'] === 'boolean') entry.disableCosmetic = cfg['disableCosmetic'];
    out[host] = entry;
  }
  return out;
}

/**
 * One stored rule from an untrusted document. Accepts BOTH stored shapes: a bare
 * selector string (every backup ever exported before labels existed) and the
 * labelled object. Anything else — a number, null, an object with no selector —
 * is dropped rather than failing the whole import.
 */
function normalizeFilterEntry(v: unknown): StoredFilter | null {
  if (typeof v === 'string') return v.trim() ? v : null;
  if (!isRecord(v)) return null;
  const selector = v['selector'];
  if (typeof selector !== 'string' || !selector.trim()) return null;
  const entry: CustomFilterEntry = { selector };
  if (typeof v['label'] === 'string' && v['label'].trim()) entry.label = v['label'];
  if (typeof v['added'] === 'number' && Number.isFinite(v['added'])) entry.added = v['added'];
  return entry;
}

export function normalizeCustomFilters(v: unknown): CustomFilters {
  const out: CustomFilters = {};
  if (!isRecord(v)) return out;
  for (const [host, stored] of Object.entries(v)) {
    if (!Array.isArray(stored)) continue;
    const entries = stored
      .map(normalizeFilterEntry)
      .filter((e): e is StoredFilter => e !== null);
    if (entries.length > 0) out[host] = entries;
  }
  return out;
}
