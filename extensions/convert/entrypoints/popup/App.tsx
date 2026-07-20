import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from '#imports';
import {
  Badge,
  Button,
  Callout,
  CopyButton,
  LanguageSwitcher,
  LocaleProvider,
  SectionHeading,
  Spinner,
  ThemeToggle,
  type Locale,
} from '@blur/ui';
import { useConvertLocale, useSettings, useThemeSetter } from '../../utils/settings';
import { useT, type MsgKey, type TFn } from '../../utils/i18n';
import {
  CATEGORIES,
  convertUnit,
  getCategory,
  getUnit,
  parseInBase,
  formatInBase,
  type CategoryId,
  type NumeralBase,
  type UnitDef,
  type UnitTag,
} from '../../utils/units';
import { formatNumber } from '../../utils/format';
import { parseQuantity } from '../../utils/parse';
import {
  CURRENCY_CODES,
  CRYPTO_SET,
  convertMoney,
  readSnapshot,
  FRESH_MS,
  type MoneySnapshot,
} from '../../utils/rates';
import {
  chineseZodiac,
  commonTimeZones,
  formatInZone,
  fromUnix,
  hasTemporal,
  localTimeZone,
  renderCalendars,
  toUnixSeconds,
} from '../../utils/datetime';
import {
  favouritesItem,
  normalizeFavourites,
  type ConvertSettings,
  type Favourite,
} from '../../utils/storage';

// The PRIMARY surface: one smart input → many outputs (PLAN.md §11.6). Four
// keyboard-first tabs (Units / Currency / Date & time / Number bases), all
// offline-first — only currency needs the network, and only for the cached rate
// TABLE (the amount is converted locally). Ambiguity (US/Imperial, decimal/binary)
// is surfaced by listing both, each tagged, never a silent default.

type Tab = 'units' | 'currency' | 'datetime' | 'bases';

function tagLabel(t: TFn, tag: UnitTag | undefined): string {
  return tag ? ` · ${t(`tag_${tag}` as MsgKey)}` : '';
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Localised "3 hours ago"-style age of a timestamp. */
function ageText(ts: number, locale: string): string {
  const diffMs = Date.now() - ts;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 60) return rtf.format(-mins, 'minute');
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}

interface HashSeed {
  tab: Tab;
  category?: CategoryId;
  fromId?: string;
  currency?: string;
  amount: string;
}

/** Read an omnibox handoff ("#q=5 mi to km") into a seed for the panels. */
function readHashSeed(): HashSeed | null {
  const hash = window.location.hash;
  const m = hash.match(/[#&]q=([^&]+)/);
  if (!m) return null;
  let text = '';
  try {
    text = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  const parsed = parseQuantity(text.replace(/\s+(?:to|in|->|→|в)\s+.*$/i, ''));
  if (!parsed) return null;
  if (parsed.kind === 'unit') {
    return { tab: 'units', category: parsed.category, fromId: parsed.unitId, amount: String(parsed.value) };
  }
  return { tab: 'currency', currency: parsed.code, amount: String(parsed.value) };
}

export function App() {
  const { locale, setLocale } = useConvertLocale();
  return (
    <LocaleProvider locale={locale}>
      <Root locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

function Root({ locale, setLocale }: { locale: Locale; setLocale: (l: Locale) => void }) {
  const t = useT();
  const { settings, update } = useSettings();
  const { theme, setTheme } = useThemeSetter(settings, update);

  const seed = useMemo(() => readHashSeed(), []);
  const [tab, setTab] = useState<Tab>(seed?.tab ?? 'units');

  const [favourites, setFavourites] = useState<Favourite[]>([]);
  useEffect(() => {
    void favouritesItem
      .getValue()
      .then((v) => normalizeFavourites(v))
      .catch(() => [])
      .then(setFavourites);
  }, []);

  const isPinned = useCallback(
    (f: Favourite) =>
      favourites.some(
        (x) => x.mode === f.mode && x.category === f.category && x.from === f.from && x.to === f.to,
      ),
    [favourites],
  );
  const togglePin = useCallback((f: Favourite) => {
    setFavourites((prev) => {
      const exists = prev.some(
        (x) => x.mode === f.mode && x.category === f.category && x.from === f.from && x.to === f.to,
      );
      const next = exists
        ? prev.filter(
            (x) => !(x.mode === f.mode && x.category === f.category && x.from === f.from && x.to === f.to),
          )
        : [...prev, f];
      void favouritesItem.setValue(next).catch(() => undefined);
      return next;
    });
  }, []);

  if (!settings) {
    return (
      <div className="wrap">
        <p className="loading" role="status" aria-live="polite">
          <Spinner label={t('loading')} />
        </p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'units', label: t('tab_units') },
    { id: 'currency', label: t('tab_currency') },
    { id: 'datetime', label: t('tab_datetime') },
    { id: 'bases', label: t('tab_bases') },
  ];

  return (
    <div className="wrap">
      <header className="head">
        <h1>{t('appTitle')}</h1>
        <ThemeToggle theme={theme} onChange={setTheme} />
      </header>

      <div className="tabs" role="tablist" aria-label={t('appTitle')}>
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            className={tab === x.id ? 'tab tab--active' : 'tab'}
            onClick={() => setTab(x.id)}
          >
            {x.label}
          </button>
        ))}
      </div>

      <main className="panel">
        {tab === 'units' && (
          <UnitsPanel
            t={t}
            locale={locale}
            precision={settings.precision}
            seed={seed}
            favourites={favourites}
            isPinned={isPinned}
            togglePin={togglePin}
          />
        )}
        {tab === 'currency' && (
          <CurrencyPanel
            t={t}
            locale={locale}
            precision={settings.precision}
            seed={seed}
            favourites={favourites}
            isPinned={isPinned}
            togglePin={togglePin}
          />
        )}
        {tab === 'datetime' && <DateTimePanel t={t} locale={locale} />}
        {tab === 'bases' && <BasesPanel t={t} />}
      </main>

      <SettingsArea
        t={t}
        settings={settings}
        update={update}
        locale={locale}
        setLocale={setLocale}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Units                                                                       */
/* -------------------------------------------------------------------------- */

interface FavProps {
  favourites: Favourite[];
  isPinned: (f: Favourite) => boolean;
  togglePin: (f: Favourite) => void;
}

function unitOption(t: TFn, u: UnitDef): string {
  return `${u.symbol}${tagLabel(t, u.tag)}`;
}

function UnitsPanel({
  t,
  locale,
  precision,
  seed,
  isPinned,
  togglePin,
  favourites,
}: {
  t: TFn;
  locale: Locale;
  precision: number;
  seed: HashSeed | null;
} & FavProps) {
  const [categoryId, setCategoryId] = useState<CategoryId>(seed?.category ?? 'length');
  const category = getCategory(categoryId)!;
  const [fromId, setFromId] = useState<string>(seed?.fromId ?? category.units[0]!.id);
  const [toId, setToId] = useState<string>(
    category.units.find((u) => u.id !== (seed?.fromId ?? category.units[0]!.id))?.id ??
      category.units[0]!.id,
  );
  const [amount, setAmount] = useState<string>(seed?.amount ?? '1');

  const onCategory = (id: CategoryId) => {
    const c = getCategory(id)!;
    setCategoryId(id);
    setFromId(c.units[0]!.id);
    setToId(c.units[1]?.id ?? c.units[0]!.id);
  };

  const value = parseAmount(amount);
  const primary = value === null ? null : convertUnit(categoryId, value, fromId, toId);
  const from = getUnit(categoryId, fromId)!;
  const to = getUnit(categoryId, toId)!;

  const swap = () => {
    setFromId(toId);
    setToId(fromId);
  };

  const primaryFav: Favourite = { mode: 'unit', category: categoryId, from: fromId, to: toId };

  return (
    <div className="conv">
      <PinnedBar
        t={t}
        favourites={favourites.filter((f) => f.mode === 'unit')}
        onLoad={(f) => {
          if (f.category) onCategory(f.category);
          setFromId(f.from);
          setToId(f.to);
        }}
        describe={(f) => {
          const c = getCategory(f.category ?? 'length');
          const a = c && getUnit(f.category ?? 'length', f.from);
          const b = c && getUnit(f.category ?? 'length', f.to);
          return `${a?.symbol ?? f.from} → ${b?.symbol ?? f.to}`;
        }}
        togglePin={togglePin}
      />

      <label className="field">
        <span>{t('category')}</span>
        <select value={categoryId} onChange={(e) => onCategory(e.target.value as CategoryId)}>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {t(`cat_${c.id}` as MsgKey)}
            </option>
          ))}
        </select>
      </label>

      <div className="io">
        <label className="field">
          <span>{t('amount')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={t('amount')}
          />
        </label>
        <label className="field">
          <span>{t('fromUnit')}</span>
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {category.units.map((u) => (
              <option key={u.id} value={u.id}>
                {unitOption(t, u)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="swap" onClick={swap} aria-label={t('swapAria')}>
          ⇅ {t('swap')}
        </button>
        <label className="field">
          <span>{t('toUnit')}</span>
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            {category.units.map((u) => (
              <option key={u.id} value={u.id}>
                {unitOption(t, u)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="primary">
        <div className="primary__val">
          {value === null || primary === null ? '—' : formatNumber(primary, locale, precision)}{' '}
          <span className="primary__sym">{to.symbol}</span>
        </div>
        <div className="primary__actions">
          {primary !== null && value !== null && (
            <CopyButton value={formatNumber(primary, locale, precision)} label={t('copyValue')} />
          )}
          <button
            type="button"
            className="pin"
            aria-pressed={isPinned(primaryFav)}
            onClick={() => togglePin(primaryFav)}
          >
            {isPinned(primaryFav) ? '★ ' + t('removeFav') : '☆ ' + t('addFav')}
          </button>
        </div>
      </div>

      <SectionHeading>{t('results')}</SectionHeading>
      <ul className="results">
        {value === null
          ? null
          : category.units
              .filter((u) => u.id !== fromId)
              .map((u) => {
                const out = convertUnit(categoryId, value, fromId, u.id);
                return (
                  <li key={u.id} className="rrow">
                    <span className="rrow__val">
                      {out === null ? '—' : formatNumber(out, locale, precision)}
                    </span>
                    <span className="rrow__sym">
                      {u.symbol}
                      {u.tag ? <Badge severity="info">{t(`tag_${u.tag}` as MsgKey)}</Badge> : null}
                    </span>
                  </li>
                );
              })}
      </ul>

      {(categoryId === 'data' || categoryId === 'dataRate') && (
        <Callout tone="info">{t('binaryNote')}</Callout>
      )}
      {categoryId === 'typography' && <Callout tone="info">{t('ref16Note')}</Callout>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Currency                                                                    */
/* -------------------------------------------------------------------------- */

function CurrencyPanel({
  t,
  locale,
  precision,
  seed,
  isPinned,
  togglePin,
  favourites,
}: {
  t: TFn;
  locale: Locale;
  precision: number;
  seed: HashSeed | null;
} & FavProps) {
  const [snapshot, setSnapshot] = useState<MoneySnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCode, setFromCode] = useState<string>(seed?.currency ?? 'USD');
  const [toCode, setToCode] = useState<string>(seed?.currency === 'EUR' ? 'USD' : 'EUR');
  const [amount, setAmount] = useState<string>(seed?.amount ?? '1');

  const reload = useCallback(async () => {
    setSnapshot(await readSnapshot());
  }, []);

  useEffect(() => {
    void reload();
    // Trigger a background refresh on open; re-read the cache when it returns.
    void browser.runtime
      .sendMessage({ type: 'convert:refreshRates', force: false })
      .then(() => reload())
      .catch(() => undefined);
  }, [reload]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await browser.runtime.sendMessage({ type: 'convert:refreshRates', force: true });
    } catch {
      // Fall through — the fail-safe UI below reflects that nothing changed.
    }
    await reload();
    setRefreshing(false);
  };

  const value = parseAmount(amount);
  const priced = snapshot && snapshot.usdPer[fromCode] !== undefined;
  const primary = value !== null && snapshot ? convertMoney(snapshot, value, fromCode, toCode) : null;
  const stale = snapshot?.fetchedAt != null && Date.now() - snapshot.fetchedAt >= FRESH_MS;

  const primaryFav: Favourite = { mode: 'currency', from: fromCode, to: toCode };

  return (
    <div className="conv">
      <Callout tone="info">{t('amountLocalNote')}</Callout>

      <PinnedBar
        t={t}
        favourites={favourites.filter((f) => f.mode === 'currency')}
        onLoad={(f) => {
          setFromCode(f.from);
          setToCode(f.to);
        }}
        describe={(f) => `${f.from} → ${f.to}`}
        togglePin={togglePin}
      />

      <div className="io">
        <label className="field">
          <span>{t('currencyAmount')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={t('currencyAmount')}
          />
        </label>
        <label className="field">
          <span>{t('fromUnit')}</span>
          <select value={fromCode} onChange={(e) => setFromCode(e.target.value)}>
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="swap"
          onClick={() => {
            setFromCode(toCode);
            setToCode(fromCode);
          }}
          aria-label={t('swapAria')}
        >
          ⇅ {t('swap')}
        </button>
        <label className="field">
          <span>{t('toUnit')}</span>
          <select value={toCode} onChange={(e) => setToCode(e.target.value)}>
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!snapshot || Object.keys(snapshot.usdPer).length === 0 ? (
        <Callout tone="warn">{t('ratesNone')}</Callout>
      ) : (
        <>
          <div className="primary">
            <div className="primary__val">
              {primary === null ? '—' : formatNumber(primary, locale, precision)}{' '}
              <span className="primary__sym">{toCode}</span>
            </div>
            <div className="primary__actions">
              {primary !== null && (
                <CopyButton value={formatNumber(primary, locale, precision)} label={t('copyValue')} />
              )}
              <button
                type="button"
                className="pin"
                aria-pressed={isPinned(primaryFav)}
                onClick={() => togglePin(primaryFav)}
              >
                {isPinned(primaryFav) ? '★ ' + t('removeFav') : '☆ ' + t('addFav')}
              </button>
            </div>
          </div>

          {priced && value !== null && (
            <ul className="results">
              {CURRENCY_CODES.filter((c) => c !== fromCode).map((c) => {
                const out = convertMoney(snapshot, value, fromCode, c);
                if (out === null) return null;
                return (
                  <li key={c} className="rrow">
                    <span className="rrow__val">{formatNumber(out, locale, precision)}</span>
                    <span className="rrow__sym">
                      {c}
                      {CRYPTO_SET.has(c) ? <Badge severity="info">crypto</Badge> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <div className="disclose">
        {stale && <Callout tone="warn">{t('ratesStale', { age: snapshot ? ageText(snapshot.fetchedAt!, locale) : '' })}</Callout>}
        {snapshot?.fiatDate && <p className="fine">{t('asOf', { date: snapshot.fiatDate })}</p>}
        {snapshot?.fetchedAt != null && (
          <p className="fine">{t('cachedAge', { age: ageText(snapshot.fetchedAt, locale) })}</p>
        )}
        {snapshot?.hasCrypto && <p className="fine">{t('coingecko')}</p>}
        <Button onClick={() => void refresh()} disabled={refreshing} variant="primary">
          {refreshing ? t('refreshing') : t('refresh')}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Date & time                                                                 */
/* -------------------------------------------------------------------------- */

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function DateTimePanel({ t, locale }: { t: TFn; locale: Locale }) {
  const [date, setDate] = useState<Date>(() => new Date());
  const [unixUnit, setUnixUnit] = useState<'seconds' | 'milliseconds'>('seconds');
  const valid = !Number.isNaN(date.getTime());

  const zones = useMemo(() => commonTimeZones(), []);
  const calendars = useMemo(() => (valid ? renderCalendars(date, locale) : []), [date, locale, valid]);
  const zodiac = useMemo(() => (valid ? chineseZodiac(date) : null), [date, valid]);
  const local = localTimeZone();

  return (
    <div className="conv">
      <p className="fine">{hasTemporal() ? t('dtTemporalNative') : t('dtTemporalFallback')}</p>

      <label className="field">
        <span>{t('dtDateTime')}</span>
        <input
          type="datetime-local"
          value={valid ? toLocalInputValue(date) : ''}
          onChange={(e) => {
            const d = new Date(e.target.value);
            if (!Number.isNaN(d.getTime())) setDate(d);
          }}
        />
      </label>

      <div className="io">
        <label className="field">
          <span>{t('dtUnix')}</span>
          <input
            type="text"
            inputMode="numeric"
            value={valid ? String(unixUnit === 'seconds' ? toUnixSeconds(date) : date.getTime()) : ''}
            onChange={(e) => {
              const n = Number(e.target.value.trim());
              const d = fromUnix(n, unixUnit);
              if (d) setDate(d);
            }}
            aria-label={t('dtUnix')}
          />
        </label>
        <label className="field">
          <span>&nbsp;</span>
          <select value={unixUnit} onChange={(e) => setUnixUnit(e.target.value as 'seconds' | 'milliseconds')}>
            <option value="seconds">{t('dtUnitSeconds')}</option>
            <option value="milliseconds">{t('dtUnitMillis')}</option>
          </select>
        </label>
        <button type="button" className="swap" onClick={() => setDate(new Date())}>
          {t('dtNow')}
        </button>
      </div>

      {!valid && <Callout tone="warn">{t('dtInvalid')}</Callout>}

      {valid && (
        <>
          <SectionHeading>{t('dtTimeZones')}</SectionHeading>
          <ul className="results">
            {zones.map((tz) => {
              const z = formatInZone(date, tz, locale);
              return (
                <li key={tz} className="zrow">
                  <span className="zrow__zone">
                    {tz === local ? `${tz} ★` : tz}
                    {z?.offsetName ? <span className="fine"> {z.offsetName}</span> : null}
                  </span>
                  <span className="zrow__time">{z ? z.formatted : t('dtCalUnsupported')}</span>
                </li>
              );
            })}
          </ul>

          <SectionHeading>{t('dtCalendars')}</SectionHeading>
          <ul className="results">
            {calendars.map((c) => (
              <li key={c.calendar} className="zrow">
                <span className="zrow__zone">{c.calendar}</span>
                <span className="zrow__time">
                  {c.text ?? t('dtCalUnsupported')}
                  {c.caveat && <Callout tone="warn">{t('dtHijriCaveat')}</Callout>}
                </span>
              </li>
            ))}
          </ul>

          {zodiac && (
            <>
              <SectionHeading>{t('dtZodiac')}</SectionHeading>
              <p className="fine">
                {t('dtZodiacLine', {
                  yearName: zodiac.yearName,
                  animal: t(`zod${zodiac.animal}` as MsgKey),
                  year: zodiac.relatedYear,
                })}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Number bases                                                                */
/* -------------------------------------------------------------------------- */

function BasesPanel({ t }: { t: TFn }) {
  const [text, setText] = useState<string>('255');
  const [base, setBase] = useState<NumeralBase>(10);
  const parsed = parseInBase(text, base);

  const bases: { b: NumeralBase; label: string }[] = [
    { b: 2, label: t('basesBin') },
    { b: 8, label: t('basesOct') },
    { b: 10, label: t('basesDec') },
    { b: 16, label: t('basesHex') },
  ];

  return (
    <div className="conv">
      <div className="io">
        <label className="field">
          <span>{t('basesInput')}</span>
          <input
            type="text"
            className="mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={t('basesInput')}
          />
        </label>
        <label className="field">
          <span>{t('basesInputBase')}</span>
          <select value={base} onChange={(e) => setBase(Number(e.target.value) as NumeralBase)}>
            {bases.map((x) => (
              <option key={x.b} value={x.b}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {parsed === null ? (
        <Callout tone="warn">{t('basesInvalid')}</Callout>
      ) : (
        <ul className="results">
          {bases.map((x) => (
            <li key={x.b} className="rrow">
              <span className="rrow__val mono">{formatInBase(parsed, x.b)}</span>
              <span className="rrow__sym">{x.label}</span>
              <CopyButton value={formatInBase(parsed, x.b)} label={t('copyValue')} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pinned bar + settings                                                       */
/* -------------------------------------------------------------------------- */

function PinnedBar({
  t,
  favourites,
  onLoad,
  describe,
  togglePin,
}: {
  t: TFn;
  favourites: Favourite[];
  onLoad: (f: Favourite) => void;
  describe: (f: Favourite) => string;
  togglePin: (f: Favourite) => void;
}) {
  if (favourites.length === 0) return null;
  return (
    <div className="pinned">
      <span className="pinned__label">{t('favourites')}</span>
      {favourites.map((f, i) => (
        <span key={`${f.from}-${f.to}-${i}`} className="pinned__chip">
          <button type="button" className="pinned__load" onClick={() => onLoad(f)}>
            {describe(f)}
          </button>
          <button
            type="button"
            className="pinned__x"
            aria-label={t('removeFav')}
            onClick={() => togglePin(f)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function SettingsArea({
  t,
  settings,
  update,
  locale,
  setLocale,
}: {
  t: TFn;
  settings: ConvertSettings;
  update: (patch: Partial<ConvertSettings>) => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
}) {
  return (
    <details className="settings">
      <summary>⚙ {t('settings')}</summary>
      <div className="settings__body">
        <label className="field">
          <span>{t('precision')}</span>
          <input
            type="range"
            min={2}
            max={12}
            value={settings.precision}
            onChange={(e) => update({ precision: Number(e.target.value) })}
          />
          <span className="mono">{settings.precision}</span>
        </label>

        <div className="field">
          <span>{t('systemDefault')}</span>
          <div className="seg">
            <button
              type="button"
              aria-pressed={settings.system === 'us'}
              className={settings.system === 'us' ? 'seg__btn seg__btn--active' : 'seg__btn'}
              onClick={() => update({ system: 'us' })}
            >
              {t('systemUs')}
            </button>
            <button
              type="button"
              aria-pressed={settings.system === 'imperial'}
              className={settings.system === 'imperial' ? 'seg__btn seg__btn--active' : 'seg__btn'}
              onClick={() => update({ system: 'imperial' })}
            >
              {t('systemImperial')}
            </button>
          </div>
        </div>

        <div className="field">
          <span>{t('interfaceLanguage')}</span>
          <LanguageSwitcher locale={locale} onChange={setLocale} label={t('interfaceLanguage')} />
        </div>

        <p className="fine">{t('selectionTip')}</p>
      </div>
    </details>
  );
}
