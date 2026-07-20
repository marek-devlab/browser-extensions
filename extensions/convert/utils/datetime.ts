// Dates, time zones and multi-calendar rendering (PLAN.md §11.4, §11.5).
//
// 🔴 PURE: `Intl` + `Date` only. No `#imports`, no React, no i18n. Everything is
// platform-native and OFFLINE.
//
// Feature detection, not assumption:
//   - `Intl.supportedValuesOf('calendar')` is queried at runtime and calendars the
//     browser cannot render are dropped gracefully (Firefox lacked chinese/persian/
//     islamic-umalqura before its 2026 ICU4X migration — Bugzilla 1954138).
//   - `Temporal` is used only behind `typeof Temporal !== 'undefined'`. This
//     iteration does NOT bundle @js-temporal/polyfill (a TODO for Safari/iOS —
//     PLAN.md §11.5, §11.7); the Intl+Date path below is the universal fallback.
//
// ⚠️ Honesty caveat carried in the data: `islamic-umalqura` is a TABULAR system,
// not lunar observation — religious dates can differ by ±1 day. The popup labels
// it so; it is never presented as an authoritative Eid/Ramadan date.

/** Feature-detect: is the native TC39 Temporal API present? (No polyfill shipped
 *  this iteration, so this is honestly false on most engines as of 2026-07.) */
export function hasTemporal(): boolean {
  return typeof (globalThis as { Temporal?: unknown }).Temporal !== 'undefined';
}

/** The IANA zone the browser resolves to, e.g. "Europe/Tallinn". */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** A curated, commonly-needed subset of IANA zones plus the resolved local zone,
 *  de-duplicated. `Intl.supportedValuesOf('timeZone')` returns ~600 — too many for
 *  a popup select — so this is a practical shortlist, not the full database. */
export function commonTimeZones(): string[] {
  const shortlist = [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Tallinn',
    'Europe/Moscow',
    'Africa/Cairo',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
  const local = localTimeZone();
  return shortlist.includes(local) ? shortlist : [local, ...shortlist];
}

export interface ZonedParts {
  /** Formatted wall-clock date+time in the target zone. */
  formatted: string;
  /** Short zone/offset name as the platform reports it, e.g. "GMT+3". */
  offsetName: string;
}

/** Format an instant in a given IANA zone, in the given locale. Returns null if
 *  the zone is rejected by the platform (so the caller shows an error, not a lie). */
export function formatInZone(date: Date, timeZone: string, locale: string): ZonedParts | null {
  try {
    const fmt = new Intl.DateTimeFormat(locale, {
      timeZone,
      dateStyle: 'full',
      timeStyle: 'long',
    });
    const formatted = fmt.format(date);
    let offsetName = '';
    try {
      const parts = new Intl.DateTimeFormat(locale, {
        timeZone,
        timeZoneName: 'shortOffset',
        hour: 'numeric',
      }).formatToParts(date);
      offsetName = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    } catch {
      offsetName = '';
    }
    return { formatted, offsetName };
  } catch {
    return null;
  }
}

/** Unix seconds → Date, guarding NaN. Accepts seconds (default) or milliseconds. */
export function fromUnix(value: number, unit: 'seconds' | 'milliseconds'): Date | null {
  if (!Number.isFinite(value)) return null;
  const ms = unit === 'seconds' ? value * 1000 : value;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → Unix seconds (integer, floored). */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** All calendars this browser can actually render, intersected with the ones we
 *  present. Order is stable and starts with gregory. */
const WANTED_CALENDARS = [
  'gregory',
  'islamic-umalqura',
  'persian',
  'hebrew',
  'chinese',
  'japanese',
  'indian',
  'buddhist',
  'coptic',
  'ethiopic',
] as const;

export type CalendarId = (typeof WANTED_CALENDARS)[number];

/** ⚠️ Calendars whose date can legitimately differ from the "official" one; the UI
 *  attaches a caveat to these. */
export const CALENDAR_CAVEAT: Partial<Record<CalendarId, true>> = {
  'islamic-umalqura': true,
};

export function supportedCalendars(): CalendarId[] {
  let available: string[] = [];
  try {
    const sov = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    available = typeof sov === 'function' ? sov('calendar') : [];
  } catch {
    available = [];
  }
  // If the platform doesn't expose supportedValuesOf, fall back to gregory only —
  // the one calendar we can rely on everywhere.
  if (available.length === 0) return ['gregory'];
  return WANTED_CALENDARS.filter((c) => available.includes(c));
}

export interface CalendarRendering {
  calendar: CalendarId;
  /** Localised date in that calendar, or null if the platform refused it. */
  text: string | null;
  caveat: boolean;
}

/** Render one instant across every supported calendar. A calendar that throws is
 *  reported with `text: null` rather than dropped silently, so the UI can say so. */
export function renderCalendars(date: Date, locale: string): CalendarRendering[] {
  return supportedCalendars().map((calendar) => {
    let text: string | null = null;
    try {
      text = new Intl.DateTimeFormat(`${locale}-u-ca-${calendar}`, {
        dateStyle: 'full',
      }).format(date);
    } catch {
      text = null;
    }
    return { calendar, text, caveat: Boolean(CALENDAR_CAVEAT[calendar]) };
  });
}

const ZODIAC_ANIMALS = [
  'Rat',
  'Ox',
  'Tiger',
  'Rabbit',
  'Dragon',
  'Snake',
  'Horse',
  'Goat',
  'Monkey',
  'Rooster',
  'Dog',
  'Pig',
] as const;

export interface ChineseZodiac {
  /** Sexagenary stem-branch year name from the platform, e.g. "甲子". */
  yearName: string;
  /** Gregorian related year, e.g. 1984. */
  relatedYear: number;
  /** Earthly-branch animal (English key the popup can translate if desired). */
  animal: (typeof ZODIAC_ANIMALS)[number];
}

/** Chinese zodiac via `formatToParts()` `yearName` + `relatedYear` (PLAN.md §11.4).
 *  Returns null if the chinese calendar isn't supported or parts are absent. */
export function chineseZodiac(date: Date): ChineseZodiac | null {
  if (!supportedCalendars().includes('chinese')) return null;
  try {
    // `yearName` / `relatedYear` are valid part types for the chinese calendar but
    // are absent from the lib's `DateTimeFormatPartTypesRegistry`, so widen here.
    const parts = new Intl.DateTimeFormat('en-u-ca-chinese', {
      year: 'numeric',
    }).formatToParts(date) as { type: string; value: string }[];
    const yearName = parts.find((p) => p.type === 'yearName')?.value ?? '';
    const relatedYearStr = parts.find((p) => p.type === 'relatedYear')?.value ?? '';
    const relatedYear = Number.parseInt(relatedYearStr, 10);
    if (!yearName || !Number.isFinite(relatedYear)) return null;
    // 1984 was 甲子, a Rat year → anchor the 12-animal cycle there.
    const idx = (((relatedYear - 1984) % 12) + 12) % 12;
    return { yearName, relatedYear, animal: ZODIAC_ANIMALS[idx]! };
  } catch {
    return null;
  }
}
