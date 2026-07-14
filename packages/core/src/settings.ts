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
  maskStyle: 'blur',
  // A dark neutral, not pure black: it reads as a deliberate redaction rather
  // than as a broken image, and it stays legible against both light and dark
  // page backgrounds.
  maskColor: '#1f2430',
  maskOpacity: 1,
  showLabels: false,
  rehideOnBlur: false,
};

/** Clamp a mask opacity into the range the UI and the filter both assume. */
export function clampMaskOpacity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0.5, v));
}

/**
 * Is `v` a colour we are willing to interpolate into an SVG data-URI filter?
 *
 * The mask colour is user input that ends up inside a `data:image/svg+xml`
 * document. Accepting arbitrary strings there would let a crafted value close
 * the attribute and inject markup into the filter. A strict hex allowlist makes
 * that impossible by construction, so the sanitizer is the type guard.
 */
export function isSafeMaskColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

export function safeMaskColor(v: unknown): string {
  return isSafeMaskColor(v) ? v : DEFAULT_BLUR.maskColor;
}

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
