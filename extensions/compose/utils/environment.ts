// "Insert environment" (design §2.9). Fills the bug-report table from
// `navigator` / `screen` / `Intl` — plus the active tab's URL, which the
// background reads under `activeTab` (a permission we already have and must
// actually use, or it is a store rejection).
//
// ⚠️ This is NOT `whoami` (design §2.9): there, the goal is to SHOW the user
// their environment; here it only exists as a block to be INSERTED. The line is
// held by the fact that this extension has no screen that displays these values
// — they exist for the length of one preview dialog and then live in the user's
// own draft. And there is no network lookup of any kind (no IP, no geo).

import type { MsgKey } from './i18n';

export interface EnvFacts {
  browser: string;
  os: string;
  screen: string;
  timezone: string;
  language: string;
  url?: string;
  userAgent?: string;
}

interface UADataLike {
  brands?: { brand: string; version: string }[];
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
}

/**
 * ⚠️ `userAgentData.getHighEntropyValues()` is Chromium-only. In Firefox the
 * OS-version / architecture fields are simply ABSENT from the table — we do not
 * render an empty row pretending we tried (design §2.9).
 */
export async function collectEnv(opts: {
  includeFullUA: boolean;
  url?: string;
  /** Localized word for "window" in the screen line (defaults to English). */
  window?: string;
}): Promise<EnvFacts> {
  const nav = navigator as Navigator & { userAgentData?: UADataLike };
  const uaData = nav.userAgentData;

  let browser = '';
  let os = '';

  if (uaData) {
    const brands = (uaData.brands ?? []).filter(
      (b) => !/not.a.brand/i.test(b.brand),
    );
    browser = brands.map((b) => `${b.brand} ${b.version}`).join(', ');
    os = uaData.platform ?? '';
    try {
      const high = await uaData.getHighEntropyValues?.([
        'platformVersion',
        'architecture',
        'uaFullVersion',
      ]);
      if (high) {
        const version = high['platformVersion'];
        const arch = high['architecture'];
        if (typeof version === 'string' && version) os += ` ${version}`;
        if (typeof arch === 'string' && arch) os += ` (${arch})`;
      }
    } catch {
      // Not available (Firefox) — leave what we have rather than guessing.
    }
  }

  if (!browser) browser = guessBrowserFromUA(nav.userAgent);
  if (!os) os = guessOsFromUA(nav.userAgent);

  const dpr = window.devicePixelRatio || 1;
  const win = opts.window ?? 'window';
  const screenText = `${screen.width}×${screen.height}${dpr !== 1 ? ` @${dpr}x` : ''}, ${win} ${window.innerWidth}×${window.innerHeight}`;

  return {
    browser: browser || '—',
    os: os || '—',
    screen: screenText,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '—',
    language: nav.language,
    url: opts.url,
    userAgent: opts.includeFullUA ? nav.userAgent : undefined,
  };
}

type Translate = (key: MsgKey, vars?: Record<string, string | number>) => string;

/** The markdown table that gets inserted into the draft (design §2.9). The row
 *  LABELS follow the UI language; the VALUES are the user's own environment. */
export function envToMarkdown(env: EnvFacts, t?: Translate): string {
  const label = (key: MsgKey, fallback: string) => (t ? t(key) : fallback);
  const rows: [string, string][] = [
    [label('env_row_browser', 'Browser'), env.browser],
    [label('env_row_os', 'OS'), env.os],
    [label('env_row_screen', 'Screen'), env.screen],
    [label('env_row_timezone', 'Time zone'), env.timezone],
    [label('env_row_language', 'Language'), env.language],
  ];
  if (env.url) rows.push([label('env_row_url', 'Page URL'), env.url]);
  if (env.userAgent) rows.push(['User-Agent', '`' + env.userAgent + '`']);

  const escapeCell = (s: string) => s.replace(/\|/g, '\\|');
  return (
    '| | |\n|---|---|\n' +
    rows.map(([k, v]) => `| ${escapeCell(k)} | ${escapeCell(v)} |`).join('\n') +
    '\n'
  );
}

function guessBrowserFromUA(ua: string): string {
  const m =
    /(Firefox)\/([\d.]+)/.exec(ua) ??
    /(Edg)\/([\d.]+)/.exec(ua) ??
    /(Chrome)\/([\d.]+)/.exec(ua) ??
    /Version\/([\d.]+).*(Safari)/.exec(ua);
  if (!m) return '';
  return /Safari/.test(m[2] ?? '') ? `Safari ${m[1]}` : `${m[1]} ${m[2]}`;
}

function guessOsFromUA(ua: string): string {
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android[ /]?([\d.]+)?/.test(ua)) return 'Android';
  if (/Mac OS X ([\d_.]+)/.test(ua)) return 'macOS ' + (/Mac OS X ([\d_.]+)/.exec(ua)?.[1] ?? '').replace(/_/g, '.');
  if (/Linux/.test(ua)) return 'Linux';
  return '';
}
