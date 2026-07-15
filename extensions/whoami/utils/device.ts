import { na, val, fromMaybe, type Field } from './field';
import type { MsgKey, TT } from './i18n';
import type { Units } from './storage';

// T0 · DEVICE HALF — 🔴 REAL, synchronous, ZERO network, ZERO permissions
// (design §0, §1.3). Everything here reads from `navigator`, `screen`, `Intl` and
// `matchMedia`. Chromium-only / async APIs (userAgentData high-entropy,
// deviceMemory, navigator.connection, navigator.gpu, WEBGL_debug_renderer_info)
// are REAL detections too: they return a real value where the API exists and an
// EXPLAINED `Field` (with the right ReasonCode) where it does not — so the "and
// here's why" chip is real rendering over a genuinely-probed value.
//
// i18n: every field carries a STABLE `key` (a catalog MsgKey), not a display
// string — that key is the field's identity for merging and filtering, and the UI
// resolves it to a label in the selected locale. Value strings that are words
// ("yes"/"no", weekday names, units, notes) are resolved through the passed-in
// translator `t`; raw facts (UA, resolution, timezone) are not translated.

/** A named group of fields, used identically by the popup tiles and the report.
 *  `titleKey`/`key` are catalog keys resolved to text at render time. */
export interface FieldGroup {
  id: string;
  titleKey: MsgKey;
  fields: { key: MsgKey; field: Field; copyable?: boolean }[];
}

function has(obj: unknown, key: string): boolean {
  return typeof obj === 'object' && obj !== null && key in obj;
}

/** Format bytes to GB or GiB per the user's unit choice (design §7). Quantised
 *  values (deviceMemory, storage quota) carry `~` at the call site, not here. */
export function formatBytes(bytes: number, units: Units, t: TT): string {
  const div = units === 'GiB' ? 1024 ** 3 : 1000 ** 3;
  const suffix = t(units === 'GiB' ? 'unit_gib' : 'unit_gb');
  const n = bytes / div;
  return `${n >= 10 ? Math.round(n) : n.toFixed(1)} ${suffix}`;
}

/* --------------------------------------------------------------------------- */
/* Synchronous groups — available in the very first paint (design §1.3).       */
/* --------------------------------------------------------------------------- */

export function collectBrowser(t: TT): FieldGroup {
  const nav = navigator;
  const uaData = has(nav, 'userAgentData')
    ? (nav as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData
    : undefined;
  const yesNo = (b: boolean) => val(b ? t('val_yes') : t('val_no'));

  return {
    id: 'browser',
    titleKey: 'grp_browser',
    fields: [
      { key: 'lbl_userAgent', field: val(nav.userAgent, { ltr: true }) },
      { key: 'lbl_engine', field: val(engineOf(nav.userAgent, t)) },
      {
        key: 'lbl_mobile',
        field:
          uaData?.mobile !== undefined
            ? yesNo(uaData.mobile)
            : yesNo(/Mobi|Android/i.test(nav.userAgent)),
      },
      { key: 'lbl_cookies', field: val(nav.cookieEnabled ? t('val_cookiesOn') : t('val_cookiesOff')) },
      { key: 'lbl_dnt', field: doNotTrack(t) },
      // ⚠️ HEV (архитектура, версия ОС, модель) — Chromium-only, async: see
      // `collectAsync`. Rendered as `chromium-only` until/unless it resolves.
      { key: 'lbl_architecture', field: na('chromium-only') },
      { key: 'lbl_osVersion', field: na('chromium-only') },
      { key: 'lbl_deviceModel', field: na('mobile-only') },
    ],
  };
}

export function collectHardware(t: TT): FieldGroup {
  return {
    id: 'hardware',
    titleKey: 'grp_hardware',
    fields: [
      { key: 'lbl_cpuCores', field: cpuCores() },
      { key: 'lbl_memory', field: deviceMemory(t) },
      { key: 'lbl_touchPoints', field: val(String(navigator.maxTouchPoints ?? 0)) },
      // ⚠️ storage.estimate() is async — resolved by collectAsync → `storageQuota`.
      { key: 'lbl_siteStorage', field: na('unsupported-here') },
    ],
  };
}

export function collectScreen(t: TT): FieldGroup {
  const s = screen;
  const yes = t('val_yes');
  const no = t('val_no');
  return {
    id: 'screen',
    titleKey: 'grp_screen',
    fields: [
      { key: 'lbl_resolution', field: val(`${s.width}×${s.height}`) },
      { key: 'lbl_available', field: val(`${s.availWidth}×${s.availHeight}`) },
      { key: 'lbl_dpr', field: val(String(window.devicePixelRatio)) },
      { key: 'lbl_colorDepth', field: val(`${s.colorDepth}-bit`) },
      { key: 'lbl_orientation', field: fromMaybe(s.orientation?.type, 'unsupported-here') },
      {
        key: 'lbl_multiScreen',
        field: has(s, 'isExtended')
          ? val((s as unknown as { isExtended: boolean }).isExtended ? yes : no)
          : na('not-implemented'),
      },
      { key: 'lbl_osDark', field: mq('(prefers-color-scheme: dark)', yes, no) },
      { key: 'lbl_reducedMotion', field: mq('(prefers-reduced-motion: reduce)', yes, no) },
    ],
  };
}

export function collectLocale(t: TT): FieldGroup {
  const dtf = Intl.DateTimeFormat().resolvedOptions();
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '−';
  const abs = Math.abs(offsetMin);
  const offset = `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? ':' + String(abs % 60).padStart(2, '0') : ''}`;
  return {
    id: 'locale',
    titleKey: 'grp_locale',
    fields: [
      { key: 'lbl_timezone', field: val(dtf.timeZone) },
      { key: 'lbl_offset', field: val(offset) },
      { key: 'lbl_locale', field: val(dtf.locale, { ltr: true }) },
      { key: 'lbl_languages', field: val(navigator.languages.join(', '), { ltr: true }) },
      { key: 'lbl_calendar', field: fromMaybe(dtf.calendar, 'unsupported-here') },
      { key: 'lbl_numberingSystem', field: fromMaybe(dtf.numberingSystem, 'unsupported-here') },
      // ⚠️ Intl.Locale weekInfo/hourCycle — limited (Firefox catching up), §12.
      { key: 'lbl_firstDay', field: weekInfo(t) },
    ],
  };
}

export function collectPrivacy(t: TT): FieldGroup {
  const yes = t('val_yes');
  const no = t('val_no');
  return {
    id: 'privacy',
    titleKey: 'grp_privacy',
    fields: [
      { key: 'lbl_gpuWebgl', field: webglRenderer() },
      // ⚠️ navigator.gpu is async — resolved in collectAsync. Chromium/limited.
      { key: 'lbl_gpuWebgpu', field: na('not-implemented') },
      { key: 'lbl_gpc', field: gpc(t) },
      { key: 'lbl_webdriver', field: val(navigator.webdriver ? yes : no) },
      { key: 'lbl_pointerType', field: mq('(pointer: fine)', t('val_pointerFine'), t('val_pointerCoarse')) },
      { key: 'lbl_hover', field: mq('(hover: hover)', t('val_hoverYes'), t('val_hoverNo')) },
      { key: 'lbl_osContrast', field: forcedColors(t) },
      { key: 'lbl_highContrast', field: mq('(prefers-contrast: more)', yes, no) },
      // 🔴 NO WebRTC local-IP probe and NO entropy/fingerprint score here. The local
      // address is unobtainable (mDNS obfuscation, PLAN.md (Часть II) §5.2) — we do not attempt
      // it and we do not promise it. An entropy estimate would need a licensed
      // frequency table; inventing numbers is forbidden (design §8.3, §14.4).
    ],
  };
}

/* --------------------------------------------------------------------------- */
/* Individual real-detection helpers                                           */
/* --------------------------------------------------------------------------- */

function cpuCores(): Field {
  const n = navigator.hardwareConcurrency;
  return typeof n === 'number' && n > 0 ? val(String(n)) : na('blocked-by-privacy');
}

function deviceMemory(t: TT): Field {
  // ⚠️ Chromium-only, and quantised to 0.25/0.5/1/2/4/8 (8 is the ceiling), so it
  // ALWAYS carries `~` — never "8 GB" as a fact (design §7).
  const dm = has(navigator, 'deviceMemory')
    ? (navigator as unknown as { deviceMemory?: number }).deviceMemory
    : undefined;
  if (typeof dm !== 'number') return na('chromium-only');
  return val(`${dm} ${t('unit_gb')}`, {
    approx: true,
    note: t('note_deviceMemory'),
  });
}

/** Global Privacy Control — a real signal (Firefox, Brave; Chrome only via
 *  extensions). Absent ≠ "off": we say the browser does not expose it. */
function gpc(t: TT): Field {
  const g = has(navigator, 'globalPrivacyControl')
    ? (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl
    : undefined;
  if (typeof g !== 'boolean') return na('not-implemented');
  return val(g ? t('val_gpcOn') : t('val_gpcOff'));
}

function doNotTrack(t: TT): Field {
  const dnt = navigator.doNotTrack;
  if (dnt === null || dnt === undefined) return na('removed-by-vendor');
  return val(dnt === '1' ? t('val_dntOn') : t('val_dntOff'));
}

function engineOf(ua: string, t: TT): string {
  if (/Firefox\//.test(ua)) return 'Gecko';
  if (/Edg\//.test(ua)) return 'Blink';
  if (/Chrome\//.test(ua)) return 'Blink';
  if (/Safari\//.test(ua)) return 'WebKit';
  return t('val_engineUnknown');
}

function mq(query: string, yes: string, no: string): Field {
  try {
    return val(window.matchMedia(query).matches ? yes : no);
  } catch {
    return na('unsupported-here');
  }
}

function forcedColors(t: TT): Field {
  try {
    return val(
      window.matchMedia('(forced-colors: active)').matches ? t('val_contrastHigh') : t('val_contrastNormal'),
    );
  } catch {
    return na('not-implemented');
  }
}

function weekInfo(t: TT): Field {
  try {
    const loc = new Intl.Locale(navigator.language) as unknown as {
      weekInfo?: { firstDay?: number };
      getWeekInfo?: () => { firstDay?: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    const first = info?.firstDay;
    if (typeof first !== 'number') return na('not-implemented');
    const dayKeys: (MsgKey | '')[] = ['', 'day_mon', 'day_tue', 'day_wed', 'day_thu', 'day_fri', 'day_sat', 'day_sun'];
    const key = dayKeys[first];
    return val(key ? t(key) : String(first));
  } catch {
    return na('not-implemented');
  }
}

function webglRenderer(): Field {
  // Real synchronous read of WEBGL_debug_renderer_info. Disabled under
  // resistFingerprinting → `blocked-by-privacy` (design §7).
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return na('unsupported-here');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return na('blocked-by-privacy');
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
    return renderer ? val(renderer, { ltr: true }) : na('blocked-by-privacy');
  } catch {
    return na('unsupported-here');
  }
}

/* --------------------------------------------------------------------------- */
/* Async augmentation (microtask/idle) — resolves the 3 skeleton fields only    */
/* (design §1.3): HEV, storage quota, GPU. Still ZERO network.                  */
/* --------------------------------------------------------------------------- */

export interface AsyncDevice {
  architecture: Field;
  osVersion: Field;
  model: Field;
  storageQuota: Field;
  webgpu: Field;
}

export async function collectAsync(units: Units, t: TT): Promise<AsyncDevice> {
  const [hev, quota, gpu] = await Promise.all([
    highEntropy(),
    storageQuota(units, t),
    webgpu(t),
  ]);
  return {
    architecture: hev.architecture,
    osVersion: hev.osVersion,
    model: hev.model,
    storageQuota: quota,
    webgpu: gpu,
  };
}

async function highEntropy(): Promise<{ architecture: Field; osVersion: Field; model: Field }> {
  const uaData = has(navigator, 'userAgentData')
    ? (navigator as unknown as {
        userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<Record<string, string>> };
      }).userAgentData
    : undefined;
  if (!uaData?.getHighEntropyValues) {
    // Firefox/Safari: does not exist and never will (design §12) — not "unknown".
    return { architecture: na('chromium-only'), osVersion: na('chromium-only'), model: na('mobile-only') };
  }
  try {
    const hev = await uaData.getHighEntropyValues(['architecture', 'bitness', 'platformVersion', 'model']);
    return {
      architecture: val(`${hev.architecture || '?'} · ${hev.bitness || '?'}-bit`, { ltr: true }),
      osVersion: fromMaybe(hev.platformVersion, 'unsupported-here'),
      model: fromMaybe(hev.model, 'mobile-only', { emptyMeans: 'mobile-only', ltr: true }),
    };
  } catch {
    // ⚠️ On some builds the promise rejects — catch to a chip, not a hung skeleton.
    return { architecture: na('not-implemented'), osVersion: na('not-implemented'), model: na('mobile-only') };
  }
}

async function storageQuota(units: Units, t: TT): Promise<Field> {
  if (!navigator.storage?.estimate) return na('unsupported-here');
  try {
    const { quota } = await navigator.storage.estimate();
    if (typeof quota !== 'number') return na('unsupported-here');
    return val(t('val_storageQuota', { size: formatBytes(quota, units, t) }), {
      approx: true,
      note: t('note_storageQuota'),
    });
  } catch {
    return na('unsupported-here');
  }
}

async function webgpu(t: TT): Promise<Field> {
  const gpu = has(navigator, 'gpu')
    ? (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu
    : undefined;
  if (!gpu?.requestAdapter) return na('not-implemented');
  try {
    const adapter = (await gpu.requestAdapter()) as {
      info?: { vendor?: string; device?: string };
    } | null;
    if (!adapter) return na('unsupported-here');
    const info = adapter.info;
    const vendor = info?.vendor ?? '';
    const device = info?.device ?? '';
    if (!vendor && !device) return na('empty-by-design');
    // ⚠️ Chrome commonly returns device:"" — say so, 🔴 do NOT substitute vendor.
    return val(device ? `${vendor} · ${device}` : `${vendor} · ${t('val_deviceEmpty')}`, {
      note: device ? undefined : t('note_webgpu'),
      ltr: true,
    });
  } catch {
    return na('unsupported-here');
  }
}
