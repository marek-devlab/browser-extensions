import type {
  BlurExtensionSettings,
  BlurSettings,
  BlurSiteConfig,
} from '@blur/core';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';
import type { ImageSourceRules } from './storage';

/* ====================================================================== */
/* Feature 1 — per-site overrides                                         */
/* ====================================================================== */

/** The blur-category fields a site may override (radius/reveal handled too). */
export type BlurOverrideKey = keyof Pick<
  BlurSettings,
  'images' | 'video' | 'posters' | 'text'
>;

/**
 * Merge a partial override into a site's config immutably. Passing an empty
 * `blur` patch AND no `enabled` removes the site entry entirely so a site with no
 * real overrides never lingers in storage.
 */
export function setSiteOverride(
  configs: Record<string, BlurSiteConfig>,
  hostname: string,
  patch: { enabled?: boolean | undefined; blur?: Partial<BlurSettings> },
): Record<string, BlurSiteConfig> {
  const prev = configs[hostname];
  const nextBlur: Partial<BlurSettings> = { ...prev?.blur, ...patch.blur };
  // Drop keys explicitly set back to `undefined` so "inherit global" is real.
  for (const key of Object.keys(nextBlur) as (keyof BlurSettings)[]) {
    if (nextBlur[key] === undefined) delete nextBlur[key];
  }
  const enabled = 'enabled' in patch ? patch.enabled : prev?.enabled;
  const next: BlurSiteConfig = { hostname };
  if (enabled !== undefined) next.enabled = enabled;
  if (Object.keys(nextBlur).length > 0) next.blur = nextBlur;

  const out = { ...configs };
  if (next.enabled === undefined && !next.blur) delete out[hostname];
  else out[hostname] = next;
  return out;
}

/** Remove every override for a site. */
export function clearSiteOverride(
  configs: Record<string, BlurSiteConfig>,
  hostname: string,
): Record<string, BlurSiteConfig> {
  const out = { ...configs };
  delete out[hostname];
  return out;
}

/** Does this site have any per-field override beyond plain on/off? */
export function hasSiteOverride(config: BlurSiteConfig | undefined): boolean {
  return !!config && (config.enabled !== undefined || config.blur !== undefined);
}

/* ====================================================================== */
/* Feature 2 — presets (single-radius portion; per-category radius needs   */
/* a core change, see REPORT.md)                                           */
/* ====================================================================== */

export type PresetName = 'light' | 'medium' | 'heavy';

export const BLUR_PRESETS: Record<PresetName, { label: string; radius: number }> = {
  light: { label: 'Light', radius: 6 },
  medium: { label: 'Medium', radius: 16 },
  heavy: { label: 'Heavy', radius: 30 },
};

/** Nearest preset for a radius, so the UI can show which one is active. */
export function presetForRadius(radius: number): PresetName | null {
  for (const [name, def] of Object.entries(BLUR_PRESETS)) {
    if (def.radius === radius) return name as PresetName;
  }
  return null;
}

/* ====================================================================== */
/* Feature 3 — keyboard shortcut: panic toggle                             */
/* ====================================================================== */

/** All media categories on, enabled, heavy radius — the panic state. */
export function panicState(base: BlurExtensionSettings): BlurExtensionSettings {
  return {
    ...base,
    enabled: true,
    blur: {
      ...base.blur,
      images: true,
      video: true,
      posters: true,
      radius: BLUR_PRESETS.heavy.radius,
    },
  };
}

/**
 * Toggle panic. `snapshot` is the stored pre-panic settings (or null when panic
 * is not active). Returns the settings to apply and the snapshot to persist.
 */
export function togglePanic(
  current: BlurExtensionSettings,
  snapshot: BlurExtensionSettings | null,
): { settings: BlurExtensionSettings; snapshot: BlurExtensionSettings | null } {
  if (snapshot) {
    // Panic was active — restore and clear the snapshot.
    return { settings: snapshot, snapshot: null };
  }
  return { settings: panicState(current), snapshot: current };
}

/* ====================================================================== */
/* Feature 5 — import / export                                            */
/* ====================================================================== */

export interface BackupPayload {
  format: 'content-blur-backup';
  version: 1;
  settings: BlurExtensionSettings;
  siteConfigs: Record<string, BlurSiteConfig>;
  imageSourceRules: ImageSourceRules;
}

export function serializeBackup(
  settings: BlurExtensionSettings,
  siteConfigs: Record<string, BlurSiteConfig>,
  imageSourceRules: ImageSourceRules,
): string {
  const payload: BackupPayload = {
    format: 'content-blur-backup',
    version: 1,
    settings,
    siteConfigs,
    imageSourceRules,
  };
  return JSON.stringify(payload, null, 2);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Coerce a per-site `blur` override, preserving its PARTIAL nature: only keys
 * actually present (and valid) are kept, so a site that overrode just `video`
 * does not silently start overriding every category after a backup round-trip.
 */
function coercePartialBlur(raw: unknown): Partial<BlurSettings> {
  if (typeof raw !== 'object' || raw === null) return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<BlurSettings> = {};
  for (const key of ['images', 'video', 'posters', 'text'] as const) {
    if (typeof o[key] === 'boolean') out[key] = o[key];
  }
  if (typeof o['radius'] === 'number' && Number.isFinite(o['radius'])) {
    out.radius = Math.min(40, Math.max(4, o['radius']));
  }
  const reveal = o['reveal'];
  if (reveal === 'hover' || reveal === 'click' || reveal === 'never') out.reveal = reveal;
  if (isStringArray(o['textPatterns'])) out.textPatterns = o['textPatterns'];
  return out;
}

function coerceBlurSettings(raw: unknown): BlurSettings {
  const d = DEFAULT_BLUR_SETTINGS.blur;
  if (typeof raw !== 'object' || raw === null) return { ...d };
  const o = raw as Record<string, unknown>;
  const reveal = o['reveal'];
  return {
    images: typeof o['images'] === 'boolean' ? o['images'] : d.images,
    video: typeof o['video'] === 'boolean' ? o['video'] : d.video,
    posters: typeof o['posters'] === 'boolean' ? o['posters'] : d.posters,
    text: typeof o['text'] === 'boolean' ? o['text'] : d.text,
    radius: typeof o['radius'] === 'number' && Number.isFinite(o['radius'])
      ? Math.min(40, Math.max(4, o['radius']))
      : d.radius,
    reveal: reveal === 'hover' || reveal === 'click' || reveal === 'never' ? reveal : d.reveal,
    textPatterns: isStringArray(o['textPatterns']) ? o['textPatterns'] : [...d.textPatterns],
  };
}

/**
 * Parse and validate an imported backup. Unknown/garbage input throws; missing
 * optional sections fall back to sane empties so a partial file still imports.
 */
export function parseBackup(text: string): {
  settings: BlurExtensionSettings;
  siteConfigs: Record<string, BlurSiteConfig>;
  imageSourceRules: ImageSourceRules;
} {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON.');
  }
  if (typeof data !== 'object' || data === null) throw new Error('Not a backup file.');
  const o = data as Record<string, unknown>;
  if (o['format'] !== 'content-blur-backup') {
    throw new Error('Unrecognized file — expected a Content Blur backup.');
  }

  const rawSettings = (o['settings'] ?? {}) as Record<string, unknown>;
  const settings: BlurExtensionSettings = {
    enabled: typeof rawSettings['enabled'] === 'boolean'
      ? rawSettings['enabled']
      : DEFAULT_BLUR_SETTINGS.enabled,
    blur: coerceBlurSettings(rawSettings['blur']),
    allowlist: isStringArray(rawSettings['allowlist']) ? rawSettings['allowlist'] : [],
  };

  const siteConfigs: Record<string, BlurSiteConfig> = {};
  const rawSites = o['siteConfigs'];
  if (typeof rawSites === 'object' && rawSites !== null) {
    for (const [host, cfg] of Object.entries(rawSites as Record<string, unknown>)) {
      if (typeof cfg !== 'object' || cfg === null) continue;
      const c = cfg as Record<string, unknown>;
      const entry: BlurSiteConfig = { hostname: host };
      if (typeof c['enabled'] === 'boolean') entry.enabled = c['enabled'];
      if (typeof c['blur'] === 'object' && c['blur'] !== null) {
        const partial = coercePartialBlur(c['blur']);
        if (Object.keys(partial).length > 0) entry.blur = partial;
      }
      if (entry.enabled !== undefined || entry.blur !== undefined) siteConfigs[host] = entry;
    }
  }

  const rawImg = o['imageSourceRules'];
  const imageSourceRules: ImageSourceRules = {
    never: typeof rawImg === 'object' && rawImg !== null && isStringArray((rawImg as Record<string, unknown>)['never'])
      ? (rawImg as { never: string[] }).never
      : [],
    always: typeof rawImg === 'object' && rawImg !== null && isStringArray((rawImg as Record<string, unknown>)['always'])
      ? (rawImg as { always: string[] }).always
      : [],
  };

  return { settings, siteConfigs, imageSourceRules };
}

/* ====================================================================== */
/* Feature 6 — image-source allow / block list                            */
/* ====================================================================== */

/**
 * Attribute the size-gate stamps on images below the minimum size. The `<img>`
 * selectors below always exclude it, so a marked image un-blurs live via CSS; the
 * attribute is only ever present when the gate is active, so this is a no-op
 * otherwise.
 */
export const SMALL_IMAGE_ATTR = 'data-bx-small';

/** Escape a domain string for safe use inside a CSS attribute-substring value. */
function cssAttrValue(domain: string): string {
  // Attribute substring selectors use a quoted string; escape backslash + quote.
  return domain.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build the effective `<img>` selector(s) given the base "images on" flag and the
 * per-domain rules. Returns:
 *  - `blur`: selector to blur (empty string if nothing to blur)
 * `never` domains are excluded from the base rule; `always` domains are blurred
 * regardless of `imagesOn`.
 */
export function buildImageSelector(
  imagesOn: boolean,
  rules: ImageSourceRules,
): string {
  const parts: string[] = [];
  const never = rules.never.filter((d) => d.trim());
  const always = rules.always.filter((d) => d.trim());
  // Size-gate exclusion, always present so a favicon / 1px tracker the JS gate
  // has marked un-blurs live. Harmless when the gate is off (nothing is marked).
  const small = `:not([${SMALL_IMAGE_ATTR}])`;

  if (imagesOn) {
    // Base rule excludes every "never" domain.
    const exclusions = never
      .map((d) => `:not([src*="${cssAttrValue(d.trim())}"])`)
      .join('');
    parts.push(`img${small}${exclusions}`);
  }
  // "always" domains blur even when the base is off; if base is on they are
  // already covered, but including them is harmless and covers the base-off case.
  for (const d of always) {
    parts.push(`img${small}[src*="${cssAttrValue(d.trim())}"]`);
  }
  return parts.join(', ');
}

/* ====================================================================== */
/* Feature — SERP / domain link hiding                                    */
/* ====================================================================== */

/**
 * Build a selector that blurs links (search-result cards, feed items) pointing at
 * any of the user's domains. Uses only the existing blur engine — no new
 * permission. Returns '' when the list is empty.
 *
 * HOST-ANCHORED: a bare `a[href*="DOMAIN"]` is dangerously over-broad — an entry
 * like `com` would blur almost every link on every page, and the domain could
 * match anywhere in a path or query string. Each domain is instead anchored so it
 * only matches as a HOST, via two substrings:
 *  - `//DOMAIN` — the host immediately after the scheme (`https://example.com`);
 *  - `.DOMAIN` — the domain as a subdomain label (`https://www.example.com`),
 *    which also correctly rejects lookalikes like `notexample.com`.
 * A leading dot on the user's entry is stripped so we never emit `..DOMAIN`.
 */
export function buildLinkSelector(domains: readonly string[]): string {
  return domains
    .map((d) => d.trim().replace(/^\.+/, ''))
    .filter(Boolean)
    .flatMap((d) => {
      const v = cssAttrValue(d);
      return [`a[href*="//${v}"]`, `a[href*=".${v}"]`];
    })
    .join(', ');
}

/* ====================================================================== */
/* Feature — keyword bulk add & import / export                           */
/* ====================================================================== */

/**
 * Merge free-form multi-line text (or an imported .txt / .json list) into an
 * existing keyword list. Splits on newlines AND commas, trims, and de-duplicates
 * against what is already there. Returns the merged list plus how many entries
 * were actually added, so the UI can report "added N".
 */
export function mergeKeywords(
  existing: readonly string[],
  incoming: string,
): { next: string[]; added: number } {
  const have = new Set(existing);
  const next = [...existing];
  let added = 0;
  for (const raw of incoming.split(/[\r\n,]+/)) {
    const term = raw.trim();
    if (!term || have.has(term)) continue;
    have.add(term);
    next.push(term);
    added++;
  }
  return { next, added };
}

/**
 * Parse an imported keyword file. A `.json` array of strings (or a
 * `{ textPatterns: [...] }` / backup object) and a plain `.txt` one-per-line file
 * are both accepted, so users can round-trip either format.
 */
export function parseKeywordFile(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const data: unknown = JSON.parse(trimmed);
      const arr = Array.isArray(data)
        ? data
        : isStringArray((data as Record<string, unknown>)?.['textPatterns'])
          ? (data as { textPatterns: string[] }).textPatterns
          : null;
      if (arr) return arr.filter((x): x is string => typeof x === 'string');
    } catch {
      // Fall through to line parsing for a .txt file that merely starts with [.
    }
  }
  return trimmed
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);
}
