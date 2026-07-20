import { createTranslator, useLocale, type Catalog, type Locale } from '@blur/ui';
import { useCallback } from 'react';

// Runtime UI catalog for the Universal Converter. English is BOTH the source of
// truth and the default; `ru` and `et` are complete mirrors, enforced at compile
// time by `Catalog<MsgKey>` (a missing key fails `tsc`), so nothing ships
// half-translated.
//
// 🔴 What is deliberately NOT translated (facts / technical tokens, not prose):
//   - Unit symbols: km, mi, °C, MiB, mpg, L/100km, kn, hp… (from utils/units.ts).
//   - Currency & crypto codes: USD, EUR, RUB, BTC, ETH.
//   - Proper nouns / provenance: CoinGecko, ECB, Frankfurter, UTC, Umm al-Qura.
//   - IANA time-zone ids and calendar ids.
// Everything a human READS as prose goes through here. The non-React surfaces
// (background omnibox/context-menu, injected selection badge) use `tAt`.

export type TFn = (key: MsgKey, vars?: Record<string, string | number>) => string;

const en = {
  loading: 'Loading…',
  appTitle: 'Universal Converter',
  interfaceLanguage: 'Interface language',

  // Tabs
  tab_units: 'Units',
  tab_currency: 'Currency',
  tab_datetime: 'Date & time',
  tab_bases: 'Number bases',

  // Category names
  cat_length: 'Length',
  cat_area: 'Area',
  cat_volume: 'Volume',
  cat_mass: 'Mass',
  cat_temperature: 'Temperature',
  cat_speed: 'Speed',
  cat_pressure: 'Pressure',
  cat_energy: 'Energy',
  cat_power: 'Power',
  cat_data: 'Data',
  cat_dataRate: 'Data rate',
  cat_time: 'Time',
  cat_angle: 'Angle',
  cat_fuelEconomy: 'Fuel economy',
  cat_typography: 'Typography',

  // Ambiguity tags (shown next to a unit so the choice is never silent)
  tag_us: 'US',
  tag_imperial: 'Imperial',
  tag_metric: 'metric',
  tag_short: 'short',
  tag_long: 'long',
  tag_decimal: 'decimal',
  tag_binary: 'binary',
  tag_ref16: '@16px',

  // Units panel
  amount: 'Amount',
  fromUnit: 'From',
  toUnit: 'To',
  category: 'Category',
  swap: 'Swap',
  swapAria: 'Swap the from and to units',
  precision: 'Significant digits',
  results: 'Results',
  copyValue: 'Copy',
  addFav: 'Pin',
  removeFav: 'Unpin',
  favourites: 'Pinned',
  noFavourites: 'No pinned conversions yet.',
  settings: 'Settings',
  theme: 'Theme',
  systemDefault: 'Default reading for “gallon”, “ton”…',
  systemUs: 'US',
  systemImperial: 'Imperial',
  ref16Note: 'em and rem are shown against a 16px root font.',
  binaryNote: 'Decimal (kB = 1000) and binary (KiB = 1024) are both listed and labelled — never one silently standing in for the other.',
  selectionTip: 'Tip: select text like “5 miles” or “20°C” on any page, then right-click → “Convert selection”.',

  // Currency
  currencyAmount: 'Amount',
  refresh: 'Refresh rates',
  refreshing: 'Refreshing…',
  asOf: 'as of {date} · ECB via Frankfurter',
  cachedAge: 'Rates cached {age}',
  coingecko: 'Crypto: Data provided by CoinGecko',
  ratesNone: 'No rate data yet. Press “Refresh rates” while online.',
  ratesStale: '⚠️ Could not refresh — showing the last cached rates ({age}). Never a made-up number.',
  amountLocalNote: '🔒 Your amount is converted on your device. Only the rate table is fetched — the amount is never sent.',
  couldNotRefresh: 'Could not refresh rates (offline or the source is unreachable). The cached table is unchanged.',

  // Date & time
  dtDateTime: 'Date & time',
  dtNow: 'Now',
  dtUnix: 'Unix timestamp',
  dtUnitSeconds: 'seconds',
  dtUnitMillis: 'milliseconds',
  dtTimeZone: 'Time zone',
  dtTimeZones: 'In other time zones',
  dtCalendars: 'In other calendars',
  dtZodiac: 'Chinese zodiac',
  dtZodiacLine: '{yearName} · year of the {animal} · {year}',
  dtCalUnsupported: 'This browser cannot render this calendar.',
  dtHijriCaveat: 'Umm al-Qura (tabular) — religious dates may vary ±1 day by local sighting.',
  dtInvalid: 'Enter a valid date or Unix time.',
  dtTemporalNative: 'Using the browser’s native Temporal API.',
  dtTemporalFallback: 'Using Intl + Date (native Temporal not available here).',

  // Chinese zodiac animals
  zodRat: 'Rat',
  zodOx: 'Ox',
  zodTiger: 'Tiger',
  zodRabbit: 'Rabbit',
  zodDragon: 'Dragon',
  zodSnake: 'Snake',
  zodHorse: 'Horse',
  zodGoat: 'Goat',
  zodMonkey: 'Monkey',
  zodRooster: 'Rooster',
  zodDog: 'Dog',
  zodPig: 'Pig',

  // Number bases
  basesInput: 'Value',
  basesInputBase: 'Input base',
  basesBin: 'Binary',
  basesOct: 'Octal',
  basesDec: 'Decimal',
  basesHex: 'Hexadecimal',
  basesInvalid: 'Not a valid number in the selected base.',
  basesResults: 'Results',

  // Non-React surfaces
  omniDefault: 'Convert, e.g. “5 mi to km”, “20 C to F”, “1 BTC to EUR”',
  omniNoParse: 'Could not parse — try “5 mi to km”',
  omniOpenPopup: 'Open the converter for currency rates',
  ctxConvertSelection: 'Convert selection',
  badgeTitle: 'Universal Converter',
  badgeLocally: 'converted on your device',
  badgeDismiss: 'Dismiss',
  badgeNoParse: 'No convertible quantity found in the selection.',
  badgeCurrencyHint: 'Open the extension popup for live currency rates.',
} as const;

export type MsgKey = keyof typeof en;

const ru: Record<MsgKey, string> = {
  loading: 'Загрузка…',
  appTitle: 'Универсальный конвертер',
  interfaceLanguage: 'Язык интерфейса',

  tab_units: 'Единицы',
  tab_currency: 'Валюта',
  tab_datetime: 'Дата и время',
  tab_bases: 'Системы счисления',

  cat_length: 'Длина',
  cat_area: 'Площадь',
  cat_volume: 'Объём',
  cat_mass: 'Масса',
  cat_temperature: 'Температура',
  cat_speed: 'Скорость',
  cat_pressure: 'Давление',
  cat_energy: 'Энергия',
  cat_power: 'Мощность',
  cat_data: 'Данные',
  cat_dataRate: 'Скорость передачи',
  cat_time: 'Время',
  cat_angle: 'Угол',
  cat_fuelEconomy: 'Расход топлива',
  cat_typography: 'Типографика',

  tag_us: 'США',
  tag_imperial: 'Имперская',
  tag_metric: 'метрическая',
  tag_short: 'короткая',
  tag_long: 'длинная',
  tag_decimal: 'десятичная',
  tag_binary: 'двоичная',
  tag_ref16: '@16px',

  amount: 'Значение',
  fromUnit: 'Из',
  toUnit: 'В',
  category: 'Категория',
  swap: 'Поменять',
  swapAria: 'Поменять местами единицы «из» и «в»',
  precision: 'Значащих цифр',
  results: 'Результаты',
  copyValue: 'Копировать',
  addFav: 'Закрепить',
  removeFav: 'Открепить',
  favourites: 'Закреплённые',
  noFavourites: 'Пока нет закреплённых конвертаций.',
  settings: 'Настройки',
  theme: 'Тема',
  systemDefault: 'Значение по умолчанию для «gallon», «ton»…',
  systemUs: 'США',
  systemImperial: 'Имперская',
  ref16Note: 'em и rem показаны относительно корневого шрифта 16px.',
  binaryNote: 'Десятичные (kB = 1000) и двоичные (KiB = 1024) единицы перечислены и помечены обе — ни одна не подменяет другую молча.',
  selectionTip: 'Совет: выделите на странице текст вроде «5 miles» или «20°C», затем правой кнопкой → «Convert selection».',

  currencyAmount: 'Сумма',
  refresh: 'Обновить курсы',
  refreshing: 'Обновление…',
  asOf: 'на {date} · ECB через Frankfurter',
  cachedAge: 'Курсы из кэша, {age}',
  coingecko: 'Крипта: данные предоставлены CoinGecko',
  ratesNone: 'Данных о курсах ещё нет. Нажмите «Обновить курсы», будучи онлайн.',
  ratesStale: '⚠️ Не удалось обновить — показаны последние кэшированные курсы ({age}). Никаких выдуманных чисел.',
  amountLocalNote: '🔒 Ваша сумма конвертируется на вашем устройстве. Загружается только таблица курсов — сумма не отправляется.',
  couldNotRefresh: 'Не удалось обновить курсы (нет сети или источник недоступен). Кэшированная таблица не изменена.',

  dtDateTime: 'Дата и время',
  dtNow: 'Сейчас',
  dtUnix: 'Метка Unix',
  dtUnitSeconds: 'секунды',
  dtUnitMillis: 'миллисекунды',
  dtTimeZone: 'Часовой пояс',
  dtTimeZones: 'В других часовых поясах',
  dtCalendars: 'В других календарях',
  dtZodiac: 'Китайский зодиак',
  dtZodiacLine: '{yearName} · год {animal} · {year}',
  dtCalUnsupported: 'Этот браузер не может отобразить этот календарь.',
  dtHijriCaveat: 'Умм аль-Кура (табличный) — религиозные даты могут отличаться на ±1 день по местному наблюдению луны.',
  dtInvalid: 'Введите корректную дату или время Unix.',
  dtTemporalNative: 'Используется встроенный API Temporal браузера.',
  dtTemporalFallback: 'Используются Intl + Date (встроенный Temporal здесь недоступен).',

  zodRat: 'Крысы',
  zodOx: 'Быка',
  zodTiger: 'Тигра',
  zodRabbit: 'Кролика',
  zodDragon: 'Дракона',
  zodSnake: 'Змеи',
  zodHorse: 'Лошади',
  zodGoat: 'Козы',
  zodMonkey: 'Обезьяны',
  zodRooster: 'Петуха',
  zodDog: 'Собаки',
  zodPig: 'Свиньи',

  basesInput: 'Значение',
  basesInputBase: 'Основание ввода',
  basesBin: 'Двоичная',
  basesOct: 'Восьмеричная',
  basesDec: 'Десятичная',
  basesHex: 'Шестнадцатеричная',
  basesInvalid: 'Недопустимое число в выбранной системе счисления.',
  basesResults: 'Результаты',

  omniDefault: 'Конвертация, напр. «5 mi to km», «20 C to F», «1 BTC to EUR»',
  omniNoParse: 'Не удалось распознать — попробуйте «5 mi to km»',
  omniOpenPopup: 'Откройте конвертер для курсов валют',
  ctxConvertSelection: 'Конвертировать выделение',
  badgeTitle: 'Универсальный конвертер',
  badgeLocally: 'сконвертировано на вашем устройстве',
  badgeDismiss: 'Закрыть',
  badgeNoParse: 'В выделении не найдено конвертируемой величины.',
  badgeCurrencyHint: 'Откройте попап расширения для актуальных курсов валют.',
};

const et: Record<MsgKey, string> = {
  loading: 'Laadimine…',
  appTitle: 'Universaalne teisendaja',
  interfaceLanguage: 'Liidese keel',

  tab_units: 'Ühikud',
  tab_currency: 'Valuuta',
  tab_datetime: 'Kuupäev ja kellaaeg',
  tab_bases: 'Arvusüsteemid',

  cat_length: 'Pikkus',
  cat_area: 'Pindala',
  cat_volume: 'Ruumala',
  cat_mass: 'Mass',
  cat_temperature: 'Temperatuur',
  cat_speed: 'Kiirus',
  cat_pressure: 'Rõhk',
  cat_energy: 'Energia',
  cat_power: 'Võimsus',
  cat_data: 'Andmed',
  cat_dataRate: 'Andmeedastuskiirus',
  cat_time: 'Aeg',
  cat_angle: 'Nurk',
  cat_fuelEconomy: 'Kütusekulu',
  cat_typography: 'Tüpograafia',

  tag_us: 'USA',
  tag_imperial: 'Briti',
  tag_metric: 'meetermõõdustik',
  tag_short: 'lühike',
  tag_long: 'pikk',
  tag_decimal: 'kümnend',
  tag_binary: 'kahend',
  tag_ref16: '@16px',

  amount: 'Väärtus',
  fromUnit: 'Millest',
  toUnit: 'Milleks',
  category: 'Kategooria',
  swap: 'Vaheta',
  swapAria: 'Vaheta „millest“ ja „milleks“ ühikud',
  precision: 'Tüvenumbreid',
  results: 'Tulemused',
  copyValue: 'Kopeeri',
  addFav: 'Kinnita',
  removeFav: 'Eemalda',
  favourites: 'Kinnitatud',
  noFavourites: 'Kinnitatud teisendusi veel pole.',
  settings: 'Seaded',
  theme: 'Teema',
  systemDefault: 'Vaikelugemine sõnadele „gallon“, „ton“…',
  systemUs: 'USA',
  systemImperial: 'Briti',
  ref16Note: 'em ja rem on näidatud 16px juurfondi suhtes.',
  binaryNote: 'Kümnend- (kB = 1000) ja kahend- (KiB = 1024) ühikud on mõlemad loetletud ja märgistatud — kumbki ei asenda teist vaikimisi.',
  selectionTip: 'Näpunäide: vali lehel tekst nagu „5 miles“ või „20°C“, seejärel parem klõps → „Convert selection“.',

  currencyAmount: 'Summa',
  refresh: 'Värskenda kursse',
  refreshing: 'Värskendan…',
  asOf: 'seisuga {date} · ECB Frankfurteri kaudu',
  cachedAge: 'Kursid vahemälust, {age}',
  coingecko: 'Krüpto: andmed pärinevad CoinGeckost',
  ratesNone: 'Kursiandmeid veel pole. Vajuta võrgus olles „Värskenda kursse“.',
  ratesStale: '⚠️ Ei õnnestunud värskendada — kuvatakse viimased vahemällu salvestatud kursid ({age}). Mitte kunagi väljamõeldud arv.',
  amountLocalNote: '🔒 Sinu summa teisendatakse sinu seadmes. Alla laaditakse ainult kursitabel — summat ei saadeta kunagi.',
  couldNotRefresh: 'Kursse ei õnnestunud värskendada (võrguühenduseta või allikas kättesaamatu). Vahemälu tabel jäi muutmata.',

  dtDateTime: 'Kuupäev ja kellaaeg',
  dtNow: 'Praegu',
  dtUnix: 'Unix-ajatempel',
  dtUnitSeconds: 'sekundid',
  dtUnitMillis: 'millisekundid',
  dtTimeZone: 'Ajavöönd',
  dtTimeZones: 'Teistes ajavööndites',
  dtCalendars: 'Teistes kalendrites',
  dtZodiac: 'Hiina sodiaak',
  dtZodiacLine: '{yearName} · {animal}-aasta · {year}',
  dtCalUnsupported: 'See brauser ei suuda seda kalendrit kuvada.',
  dtHijriCaveat: 'Umm al-Qura (tabelipõhine) — usupühade kuupäevad võivad kohaliku vaatluse järgi erineda ±1 päeva.',
  dtInvalid: 'Sisesta kehtiv kuupäev või Unix-aeg.',
  dtTemporalNative: 'Kasutusel on brauseri natiivne Temporal API.',
  dtTemporalFallback: 'Kasutusel on Intl + Date (natiivne Temporal pole siin saadaval).',

  zodRat: 'Roti',
  zodOx: 'Härja',
  zodTiger: 'Tiigri',
  zodRabbit: 'Küüliku',
  zodDragon: 'Draakoni',
  zodSnake: 'Mao',
  zodHorse: 'Hobuse',
  zodGoat: 'Kitse',
  zodMonkey: 'Ahvi',
  zodRooster: 'Kuke',
  zodDog: 'Koera',
  zodPig: 'Sea',

  basesInput: 'Väärtus',
  basesInputBase: 'Sisendi alus',
  basesBin: 'Kahend',
  basesOct: 'Kaheksand',
  basesDec: 'Kümnend',
  basesHex: 'Kuueteistkümnend',
  basesInvalid: 'Valitud arvusüsteemis vigane arv.',
  basesResults: 'Tulemused',

  omniDefault: 'Teisenda, nt „5 mi to km“, „20 C to F“, „1 BTC to EUR“',
  omniNoParse: 'Ei suutnud tuvastada — proovi „5 mi to km“',
  omniOpenPopup: 'Ava teisendaja valuutakursside jaoks',
  ctxConvertSelection: 'Teisenda valik',
  badgeTitle: 'Universaalne teisendaja',
  badgeLocally: 'teisendatud sinu seadmes',
  badgeDismiss: 'Sulge',
  badgeNoParse: 'Valikust ei leitud teisendatavat väärtust.',
  badgeCurrencyHint: 'Ava laienduse hüpikaken reaalajas valuutakursside jaoks.',
};

const messages: Catalog<MsgKey> = { en, ru, et };

const translate = createTranslator<MsgKey>(messages);

/** Hook: a locale-bound `t()` for the React popup. */
export function useT(): TFn {
  const locale = useLocale();
  return useCallback(
    (key: MsgKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}

/** Imperative translator for the non-React surfaces (background omnibox/context
 *  menu, injected selection badge), which resolve the locale from storage. */
export function tAt(locale: Locale, key: MsgKey, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars);
}
