import { na, val, fromMaybe, type Field } from './field';
import type { Units } from './storage';

// T0 · DEVICE HALF — 🔴 REAL, synchronous, ZERO network, ZERO permissions
// (design §0, §1.3). Everything here reads from `navigator`, `screen`, `Intl` and
// `matchMedia`. Chromium-only / async APIs (userAgentData high-entropy,
// deviceMemory, navigator.connection, navigator.gpu, WEBGL_debug_renderer_info)
// are REAL detections too: they return a real value where the API exists and an
// EXPLAINED `Field` (with the right ReasonCode) where it does not — so the "and
// here's why" chip is real rendering over a genuinely-probed value.

/** A named group of fields, used identically by the popup tiles and the report. */
export interface FieldGroup {
  id: string;
  title: string;
  fields: { label: string; field: Field; copyable?: boolean }[];
}

function has(obj: unknown, key: string): boolean {
  return typeof obj === 'object' && obj !== null && key in obj;
}

/** Format bytes to GB or GiB per the user's unit choice (design §7). Quantised
 *  values (deviceMemory, storage quota) carry `~` at the call site, not here. */
export function formatBytes(bytes: number, units: Units): string {
  const div = units === 'GiB' ? 1024 ** 3 : 1000 ** 3;
  const suffix = units === 'GiB' ? 'ГиБ' : 'ГБ';
  const n = bytes / div;
  return `${n >= 10 ? Math.round(n) : n.toFixed(1)} ${suffix}`;
}

/* --------------------------------------------------------------------------- */
/* Synchronous groups — available in the very first paint (design §1.3).       */
/* --------------------------------------------------------------------------- */

export function collectBrowser(): FieldGroup {
  const nav = navigator;
  const uaData = has(nav, 'userAgentData')
    ? (nav as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData
    : undefined;

  return {
    id: 'browser',
    title: 'Устройство и браузер',
    fields: [
      { label: 'User-Agent', field: val(nav.userAgent, { ltr: true }) },
      { label: 'Движок', field: val(engineOf(nav.userAgent)) },
      {
        label: 'Мобильный',
        field:
          uaData?.mobile !== undefined
            ? val(uaData.mobile ? 'да' : 'нет')
            : val(/Mobi|Android/i.test(nav.userAgent) ? 'да' : 'нет'),
      },
      { label: 'Cookies', field: val(nav.cookieEnabled ? 'разрешены' : 'запрещены') },
      { label: 'Do Not Track', field: doNotTrack() },
      // ⚠️ HEV (архитектура, версия ОС, модель) — Chromium-only, async: see
      // `collectAsync`. Rendered as `chromium-only` until/unless it resolves.
      { label: 'Архитектура', field: na('chromium-only') },
      { label: 'Версия ОС', field: na('chromium-only') },
      { label: 'Модель устройства', field: na('mobile-only') },
    ],
  };
}

export function collectHardware(): FieldGroup {
  return {
    id: 'hardware',
    title: 'CPU и память',
    fields: [
      { label: 'Ядер CPU (логических)', field: cpuCores() },
      { label: 'Память', field: deviceMemory() },
      { label: 'Тач-точек', field: val(String(navigator.maxTouchPoints ?? 0)) },
      // ⚠️ storage.estimate() is async — resolved by collectAsync → `storageQuota`.
      { label: 'Хранилище для сайтов', field: na('unsupported-here') },
    ],
  };
}

export function collectScreen(): FieldGroup {
  const s = screen;
  return {
    id: 'screen',
    title: 'Экран',
    fields: [
      { label: 'Разрешение', field: val(`${s.width}×${s.height}`) },
      { label: 'Доступно', field: val(`${s.availWidth}×${s.availHeight}`) },
      { label: 'Плотность (DPR)', field: val(String(window.devicePixelRatio)) },
      { label: 'Глубина цвета', field: val(`${s.colorDepth}-bit`) },
      { label: 'Ориентация', field: fromMaybe(s.orientation?.type, 'unsupported-here') },
      {
        label: 'Несколько экранов',
        field: has(s, 'isExtended')
          ? val((s as unknown as { isExtended: boolean }).isExtended ? 'да' : 'нет')
          : na('not-implemented'),
      },
      { label: 'Тёмная тема ОС', field: mq('(prefers-color-scheme: dark)', 'да', 'нет') },
      { label: 'Сниж. движение', field: mq('(prefers-reduced-motion: reduce)', 'да', 'нет') },
    ],
  };
}

export function collectLocale(): FieldGroup {
  const dtf = Intl.DateTimeFormat().resolvedOptions();
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '−';
  const abs = Math.abs(offsetMin);
  const offset = `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? ':' + String(abs % 60).padStart(2, '0') : ''}`;
  return {
    id: 'locale',
    title: 'Локаль и время',
    fields: [
      { label: 'Таймзона', field: val(dtf.timeZone) },
      { label: 'Смещение', field: val(offset) },
      { label: 'Локаль', field: val(dtf.locale, { ltr: true }) },
      { label: 'Языки', field: val(navigator.languages.join(', '), { ltr: true }) },
      { label: 'Календарь', field: fromMaybe(dtf.calendar, 'unsupported-here') },
      { label: 'Система счёта', field: fromMaybe(dtf.numberingSystem, 'unsupported-here') },
      // ⚠️ Intl.Locale weekInfo/hourCycle — limited (Firefox catching up), §12.
      { label: 'Первый день недели', field: weekInfo() },
    ],
  };
}

export function collectPrivacy(): FieldGroup {
  return {
    id: 'privacy',
    title: 'Приватность',
    fields: [
      { label: 'GPU (WebGL)', field: webglRenderer() },
      // ⚠️ navigator.gpu is async — resolved in collectAsync. Chromium/limited.
      { label: 'GPU (WebGPU)', field: na('not-implemented') },
      { label: 'Global Privacy Control', field: gpc() },
      { label: 'Автоматизация (webdriver)', field: val(navigator.webdriver ? 'да' : 'нет') },
      { label: 'Тип указателя', field: mq('(pointer: fine)', 'мышь/трекпад', 'сенсор/грубый') },
      { label: 'Наведение (hover)', field: mq('(hover: hover)', 'есть', 'нет') },
      { label: 'Контраст ОС', field: forcedColors() },
      { label: 'Повышенный контраст', field: mq('(prefers-contrast: more)', 'да', 'нет') },
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

function deviceMemory(): Field {
  // ⚠️ Chromium-only, and quantised to 0.25/0.5/1/2/4/8 (8 is the ceiling), so it
  // ALWAYS carries `~` — never "8 GB" as a fact (design §7).
  const dm = has(navigator, 'deviceMemory')
    ? (navigator as unknown as { deviceMemory?: number }).deviceMemory
    : undefined;
  if (typeof dm !== 'number') return na('chromium-only');
  return val(`${dm} ГБ`, {
    approx: true,
    note: '≥ значения. Браузер округляет до 0.25/0.5/1/2/4/8 ГБ и не различает 8, 16 и 64 ГБ.',
  });
}

/** Global Privacy Control — a real signal (Firefox, Brave; Chrome only via
 *  extensions). Absent ≠ "off": we say the browser does not expose it. */
function gpc(): Field {
  const g = has(navigator, 'globalPrivacyControl')
    ? (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl
    : undefined;
  if (typeof g !== 'boolean') return na('not-implemented');
  return val(g ? 'включён (сайтам сообщается «не продавать мои данные»)' : 'выключен');
}

function doNotTrack(): Field {
  const dnt = navigator.doNotTrack;
  if (dnt === null || dnt === undefined) return na('removed-by-vendor');
  return val(dnt === '1' ? 'включён' : 'выключен');
}

function engineOf(ua: string): string {
  if (/Firefox\//.test(ua)) return 'Gecko';
  if (/Edg\//.test(ua)) return 'Blink';
  if (/Chrome\//.test(ua)) return 'Blink';
  if (/Safari\//.test(ua)) return 'WebKit';
  return 'неизвестен';
}

function mq(query: string, yes: string, no: string): Field {
  try {
    return val(window.matchMedia(query).matches ? yes : no);
  } catch {
    return na('unsupported-here');
  }
}

function forcedColors(): Field {
  try {
    return val(window.matchMedia('(forced-colors: active)').matches ? 'высокий контраст' : 'обычный');
  } catch {
    return na('not-implemented');
  }
}

function weekInfo(): Field {
  try {
    const loc = new Intl.Locale(navigator.language) as unknown as {
      weekInfo?: { firstDay?: number };
      getWeekInfo?: () => { firstDay?: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    const first = info?.firstDay;
    if (typeof first !== 'number') return na('not-implemented');
    const days = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
    return val(days[first] ?? String(first));
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

export async function collectAsync(units: Units): Promise<AsyncDevice> {
  const [hev, quota, gpu] = await Promise.all([
    highEntropy(),
    storageQuota(units),
    webgpu(),
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

async function storageQuota(units: Units): Promise<Field> {
  if (!navigator.storage?.estimate) return na('unsupported-here');
  try {
    const { quota } = await navigator.storage.estimate();
    if (typeof quota !== 'number') return na('unsupported-here');
    return val(`${formatBytes(quota, units)} доступно для сайтов`, {
      approx: true,
      note: 'Это не размер диска и не свободное место, а лимит для хранилищ сайтов — и он намеренно неточен.',
    });
  } catch {
    return na('unsupported-here');
  }
}

async function webgpu(): Promise<Field> {
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
    return val(device ? `${vendor} · ${device}` : `${vendor} · (device пусто)`, {
      note: device ? undefined : 'Chrome намеренно отдаёт пустую строку для модели GPU.',
      ltr: true,
    });
  } catch {
    return na('unsupported-here');
  }
}
