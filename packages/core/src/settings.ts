import type {
  AdBlockExtensionSettings,
  AdBlockLevel,
  AdBlockSettings,
  AdBlockSiteConfig,
  BlurExtensionSettings,
  BlurSettings,
  BlurSiteConfig,
} from './types';

/* ------------------------------------------------------------------ */
/* Blur extension                                                      */
/* ------------------------------------------------------------------ */

export const DEFAULT_BLUR: BlurSettings = {
  images: true,
  video: false,
  posters: true,
  text: false,
  radius: 16,
  reveal: 'hover',
  textPatterns: [],
};

export const DEFAULT_BLUR_SETTINGS: BlurExtensionSettings = {
  enabled: true,
  blur: DEFAULT_BLUR,
  allowlist: [],
};

/** Every blur feature off means the content script can skip injection entirely. */
export function anyBlurEnabled(blur: BlurSettings): boolean {
  return blur.images || blur.video || blur.posters || blur.text;
}

export function resolveBlurSettings(
  global: BlurExtensionSettings,
  site: BlurSiteConfig | undefined,
): BlurExtensionSettings {
  if (!site) return global;
  return {
    ...global,
    enabled: site.enabled ?? global.enabled,
    blur: { ...global.blur, ...site.blur },
  };
}

/* ------------------------------------------------------------------ */
/* AdBlock extension                                                   */
/* ------------------------------------------------------------------ */

export const DEFAULT_ADBLOCK: AdBlockSettings = {
  level: 'standard',
  blockAds: true,
  blockTrackers: true,
  stripTrackingParams: true,
  blockAnnoyances: false,
};

/**
 * The per-list defaults a strictness level implies. Selecting a level in the UI
 * applies these to the three list toggles; the user may then override any single
 * list. `stripTrackingParams` is intentionally NOT part of the preset — it is an
 * orthogonal privacy toggle the user owns independently of strictness.
 */
export function adBlockPresetForLevel(
  level: AdBlockLevel,
): Pick<AdBlockSettings, 'blockAds' | 'blockTrackers' | 'blockAnnoyances'> {
  switch (level) {
    case 'off':
      return { blockAds: false, blockTrackers: false, blockAnnoyances: false };
    case 'standard':
      return { blockAds: true, blockTrackers: true, blockAnnoyances: false };
    case 'aggressive':
      return { blockAds: true, blockTrackers: true, blockAnnoyances: true };
  }
}

export const DEFAULT_ADBLOCK_SETTINGS: AdBlockExtensionSettings = {
  enabled: true,
  adblock: DEFAULT_ADBLOCK,
  allowlist: [],
};

/** Copy for the strictness selector. Mirrors uBlock Origin Lite's mode system. */
export const ADBLOCK_LEVELS: Record<
  AdBlockLevel,
  { label: string; description: string }
> = {
  off: {
    label: 'Off',
    description: 'No network or cosmetic filtering.',
  },
  standard: {
    label: 'Standard',
    description: 'EasyList + EasyPrivacy. Site-specific cosmetic rules only.',
  },
  aggressive: {
    label: 'Aggressive',
    description:
      'Adds the annoyances list plus generic cosmetic filtering. May break some sites.',
  },
};

export function resolveAdBlockSettings(
  global: AdBlockExtensionSettings,
  site: AdBlockSiteConfig | undefined,
): AdBlockExtensionSettings {
  if (!site) return global;
  return {
    ...global,
    enabled: site.enabled ?? global.enabled,
    adblock: { ...global.adblock, ...site.adblock },
  };
}

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

/**
 * Allowlisting a domain covers its subdomains, matching how rule hostnames and
 * per-site configs resolve elsewhere. Exact `includes` would leave
 * `www.example.com` unfiltered by an `example.com` entry, surprising users.
 */
export function isAllowlisted(allowlist: string[], hostname: string): boolean {
  return allowlist.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}
