import { useEffect, useRef, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { Badge, Button, Callout } from '@blur/ui';
import {
  requestAllUrls,
  requestScripting,
  revokeAllUrls,
  usePermissionFact,
} from '../../../utils/permissions';
import { highlightSupported } from '../../../utils/highlight';
import { documentItem } from '../../../utils/storage';
import type { DevdataPrefs, FormatPref } from '../../../utils/storage';
import type { PrefsApi } from '../../../utils/prefs';

// The Settings tab — also the browser's "Options" target (`tool.html#/settings`).
//
// Two rules this screen exists to honour:
//  1. Controls are DISABLED until storage has been read. Rendering defaults as
//     if they were the user's settings means the first click persists them over
//     the real ones (design §5.7, §8).
//  2. The permission rows show the FACT (`permissions.contains`), never a stored
//     flag. `prefs.autoFormat` is only an INTENT: it syncs across devices, the
//     grant does not (design §3, §2.11).

/** Runtime feature-detect for JSON.parse source access (ES2026, design §5.6). */
function hasSourceAccess(): boolean {
  try {
    let seen = false;
    const reviver = (_k: string, v: unknown, ctx?: { source?: string }): unknown => {
      if (ctx && ctx.source !== undefined) seen = true;
      return v;
    };
    (JSON.parse as (text: string, reviver: unknown) => unknown)('1', reviver);
    return seen;
  } catch {
    return false;
  }
}

export function SettingsTab({ prefs, update, ready, error, retry }: PrefsApi) {
  const d = !ready;
  const [sourceAccess] = useState(hasSourceAccess);
  const [highlights] = useState(highlightSupported);

  return (
    <div className="settings">
      {!ready && error === null && (
        <Callout tone="info">Читаем настройки… контролы заблокированы до загрузки.</Callout>
      )}
      {error !== null && (
        <Callout tone="poor" title="Не удалось прочитать настройки">
          {error}
          <div className="row row--gap">
            <Button onClick={retry}>Повторить</Button>
          </div>
        </Callout>
      )}

      <Section title="Вид">
        <Row label="Отступ">
          <select
            disabled={d}
            value={prefs?.indent ?? '2'}
            onChange={(e) => update({ indent: e.target.value as DevdataPrefs['indent'] })}
          >
            <option value="2">2 пробела</option>
            <option value="4">4 пробела</option>
            <option value="tab">Tab</option>
            <option value="min">Minified</option>
          </select>
        </Row>
        <Toggle
          label="Перенос длинных строк"
          hint="На больших документах перенос отключается автоматически: он несовместим с виртуализацией строк."
          disabled={d}
          checked={prefs?.wrap ?? true}
          onChange={(v) => update({ wrap: v })}
        />
        <Toggle
          label="Показывать номера строк"
          disabled={d}
          checked={prefs?.lineNumbers ?? true}
          onChange={(v) => update({ lineNumbers: v })}
        />
        <Row label="Стартовый таб">
          <select
            disabled={d}
            value={prefs?.defaultTab ?? 'data'}
            onChange={(e) =>
              update({ defaultTab: e.target.value as DevdataPrefs['defaultTab'] })
            }
          >
            <option value="data">Данные</option>
            <option value="jwt">JWT</option>
            <option value="schema">Схема</option>
          </select>
        </Row>
        {!highlights && (
          <Callout tone="warn">
            ⚠ Этот браузер не поддерживает CSS Custom Highlight API — подсветка синтаксиса не
            работает. Текст показывается без цвета; подделывать подсветку тысячами{' '}
            <span className="mono">&lt;span&gt;</span> мы не будем (это и медленно, и открывает
            дыру для инъекции разметки).
          </Callout>
        )}
      </Section>

      <Section title="Разбор">
        <Row label="Формат по умолчанию">
          <select
            disabled={d}
            value={prefs?.defaultFormat ?? 'auto'}
            onChange={(e) => update({ defaultFormat: e.target.value as FormatPref })}
          >
            <option value="auto">Автоопределение</option>
            <option value="json">JSON</option>
            <option value="json5">JSON5</option>
            <option value="jsonc">JSONC</option>
            <option value="yaml">YAML</option>
            <option value="xml">XML</option>
            <option value="csv">CSV</option>
          </select>
        </Row>
        <Toggle
          label="Сортировать ключи"
          hint="Только ВЫВОД (beautify/конвертация). Дерево всегда показывает исходный порядок — иначе мы врали бы о документе."
          disabled={d}
          checked={prefs?.sortKeys ?? false}
          onChange={(v) => update({ sortKeys: v })}
        />
        <Row label="Разворачивать дерево до">
          <select
            disabled={d}
            value={prefs?.expandDepth ?? 2}
            onChange={(e) => update({ expandDepth: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} уровней
              </option>
            ))}
          </select>
        </Row>

        {/* Honesty, not pessimism: exact big numbers are ALWAYS available for
            JSON/JSONC, because we read the scalar's source text straight out of
            the document via jsonc-parser offsets. JSON.parse source access, when
            the engine has it, is simply a second route to the same truth. What we
            cannot do is recover the source spelling for YAML/CSV/JSON5, whose
            parsers hand back values — and the inspector says exactly that. */}
        <Callout tone={sourceAccess ? 'info' : 'warn'}>
          <strong>Точные большие числа.</strong>{' '}
          {sourceAccess
            ? 'Ваш браузер поддерживает JSON.parse source access (ES2026).'
            : 'Ваш браузер НЕ поддерживает JSON.parse source access (ES2026).'}{' '}
          Для JSON и JSONC это не имеет значения: исходное написание чисел мы берём из позиций
          токенов в самом документе, поэтому{' '}
          <span className="mono">12345678901234567890</span> показывается как есть в любом
          браузере. Для YAML, CSV и JSON5 исходное написание недоступно в принципе — их парсеры
          отдают уже округлённые значения, и инспектор пишет об этом прямо, а не показывает
          округлённое как исходное.
        </Callout>

        <Row label="Разделитель CSV">
          <select
            disabled={d}
            value={prefs?.csvDelimiter ?? 'auto'}
            onChange={(e) =>
              update({ csvDelimiter: e.target.value as DevdataPrefs['csvDelimiter'] })
            }
          >
            <option value="auto">авто</option>
            <option value="comma">запятая ,</option>
            <option value="semicolon">точка с запятой ;</option>
            <option value="tab">Tab</option>
          </select>
        </Row>
        <Toggle
          label="BOM при экспорте CSV"
          hint="Без BOM Excel читает UTF-8 как локальную кодировку и ломает кириллицу."
          disabled={d}
          checked={prefs?.csvBom ?? true}
          onChange={(v) => update({ csvBom: v })}
        />
      </Section>

      <Section title="JSON Schema">
        <Row label="Драфт">
          <select
            disabled={d}
            value={prefs?.schemaDraft ?? '2020-12'}
            onChange={(e) =>
              update({ schemaDraft: e.target.value as DevdataPrefs['schemaDraft'] })
            }
          >
            <option value="2020-12">2020-12</option>
            <option value="2019-09">2019-09</option>
            <option value="7">7</option>
            <option value="4">4</option>
          </select>
        </Row>
        <Toggle
          label="Проверять format:"
          hint="По спецификации format — аннотация, а не ограничение. Когда выключено, ключевое слово убирается из схемы перед проверкой, а не просто прячется из отчёта."
          disabled={d}
          checked={prefs?.schemaFormats ?? false}
          onChange={(v) => update({ schemaFormats: v })}
        />
      </Section>

      <Section title="Хранение">
        <Toggle
          label="Восстанавливать последний документ"
          disabled={d}
          checked={prefs?.restore ?? true}
          onChange={(v) => update({ restore: v })}
        />
        <Callout tone="warn">
          ⚠ Сохраняется только в этом браузере (<span className="mono">storage.local</span>), до
          1 МБ. Документы больше 1 МБ не сохраняются — и мы об этом говорим, а не теряем их молча.
          Содержимое таба JWT не сохраняется <strong>НИКОГДА</strong>: для токена, секрета и ключа
          в этом расширении просто нет места в хранилище.
        </Callout>
        <EraseDocumentButton disabled={d} />
      </Section>

      <PageFormattingSection prefs={prefs} update={update} disabled={d} />

      <Section title="О расширении">
        <p className="fine">
          Версия 1.0.0 · Ноль сети · Ноль аналитики · Открытый код
        </p>
        <Callout tone="info">
          У расширения нет ни одного сетевого вызова: ни <span className="mono">fetch</span>, ни
          загрузки JWKS по URL, ни внешних <span className="mono">$ref</span>, ни телеметрии, ни
          отчётов об ошибках. Всё, что вы сюда вставите, остаётся во вкладке.
        </Callout>
        <p className="fine">
          Библиотеки: jsonc-parser (MIT) · json5 (MIT) · yaml (ISC) · papaparse (MIT) · jose (MIT)
          · @cfworker/json-schema (MIT). XML — нативный DOMParser. Полные тексты лицензий — в
          файле <span className="mono">THIRD-PARTY-NOTICES.md</span> в пакете расширения.
        </p>
      </Section>
    </div>
  );
}

/* --------------- Page formatting: permission FACTS + consent -------------- */

function PageFormattingSection({
  prefs,
  update,
  disabled,
}: {
  prefs: DevdataPrefs | null;
  update: (patch: Partial<DevdataPrefs>) => void;
  disabled: boolean;
}) {
  const scripting = usePermissionFact('scripting');
  const allUrls = usePermissionFact('allUrls');
  const dialog = useRef<HTMLDialogElement>(null);
  const [denied, setDenied] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The background owns the content-script registration and keeps it in step
  // with the permission + intent (entrypoints/background.ts). Ask it to re-sync
  // whenever either changes, so a grant takes effect without a restart.
  const sync = () => {
    void browser.runtime.sendMessage({ type: 'devdata:sync-autoformat' }).catch(() => undefined);
  };

  useEffect(() => {
    if (allUrls === null) return;
    sync();
  }, [allUrls, prefs?.autoFormat]);

  const grant = async () => {
    const ok = await requestAllUrls();
    dialog.current?.close();
    // The toggle MUST fall back to "off" on refusal. An optimistic toggle that
    // stayed on would be a lie — the same class of bug as adblock's "Pause" that
    // silently did nothing (design §2.11).
    if (ok) {
      update({ autoFormat: true });
      setDenied(false);
    } else {
      update({ autoFormat: false });
      setDenied(true);
    }
  };

  const revoke = async () => {
    const ok = await revokeAllUrls();
    update({ autoFormat: false });
    setNote(
      ok
        ? 'Доступ отозван, скрипт снят с регистрации.'
        : 'Браузер не отозвал доступ — снимите его вручную на странице расширений.',
    );
    setTimeout(() => setNote(null), 4000);
  };

  return (
    <Section title="Форматирование страниц">
      <div className="setrow">
        <div>
          <div className="setrow__label">Форматировать по клику</div>
          <div className="fine">
            Разово, только текущая вкладка. Доступ к сайтам не выдаётся: вкладку на этот момент
            открывает сам клик по иконке (activeTab).
          </div>
        </div>
        {scripting === null ? (
          <span className="fine">проверяем…</span>
        ) : scripting ? (
          <Badge severity="ok">✓ Разрешено</Badge>
        ) : (
          <Button disabled={disabled} onClick={() => void requestScripting()}>
            Разрешить
          </Button>
        )}
      </div>

      <div className="setrow">
        <div>
          <div className="setrow__label">Авто-формат JSON-страниц</div>
          {allUrls === true ? (
            <div className="fine">
              ✓ Доступ выдан. ⚠ В Firefox встроенный просмотрщик JSON перехватывает страницу раньше
              нас — см. ниже.
            </div>
          ) : denied ? (
            <div className="fine">
              Доступ не выдан — фича не работает. Всё остальное работает как работало.
            </div>
          ) : (
            <div className="fine">⚠ Требует доступа ко всем сайтам. Подробности — по кнопке.</div>
          )}
        </div>
        {allUrls === true ? (
          <Button onClick={() => void revoke()}>Отозвать доступ</Button>
        ) : (
          <Button
            disabled={disabled || allUrls === null}
            onClick={() => {
              setDenied(false);
              dialog.current?.showModal();
            }}
          >
            {denied ? 'Попробовать снова' : 'Включить'}
          </Button>
        )}
      </div>

      {note !== null && <p className="fine" role="status">{note}</p>}

      {allUrls === true && prefs?.autoFormat === false && (
        <Callout tone="warn">
          Доступ выдан, но авто-формат выключен настройкой. Он ничего не делает, пока вы не
          включите его снова — либо отзовите доступ, чтобы не держать лишнее разрешение.
          <div className="row row--gap">
            <Button onClick={() => update({ autoFormat: true })}>Включить авто-формат</Button>
          </div>
        </Callout>
      )}

      <Callout tone="warn" title="⚠ Firefox: встроенный просмотрщик JSON выигрывает у нас">
        Firefox сам перехватывает <span className="mono">application/json</span>, и отключить его
        из расширения <strong>невозможно</strong> — такого API нет, и мы не будем притворяться,
        что он есть. Чтобы работал наш вид: откройте <span className="mono">about:config</span>,
        найдите <span className="mono">devtools.jsonview.enabled</span> и поставьте{' '}
        <span className="mono">false</span>. Всё остальное в расширении работает без этого.
      </Callout>

      {/* The honest consent screen comes BEFORE the browser's prompt (§2.11).
          Native <dialog>: focus trap + ::backdrop for free. */}
      <dialog ref={dialog} className="consent">
        <h3>Авто-форматирование JSON-страниц</h3>
        <p>
          <strong>Что это даёт.</strong> Когда вы открываете URL, отдающий{' '}
          <span className="mono">application/json</span>, расширение само покажет его деревом — без
          клика по иконке.
        </p>
        <p>
          <strong>Что браузер спросит.</strong> «Читать и изменять все ваши данные на всех
          веб-сайтах». Это единственная формулировка, которую даёт Chrome. Мягче не бывает — иначе
          фича невозможна.
        </p>
        <p>
          <strong>Почему так грубо.</strong> Браузер не умеет давать доступ «только к
          JSON-страницам»: чтобы узнать тип документа, скрипт уже должен быть на странице.
          activeTab не подходит — он выдаётся только по вашему клику, а здесь клика нет по
          определению.
        </p>
        <p>
          <strong>Что мы будем делать с этим доступом.</strong> Ровно одно: на document_start
          проверять <span className="mono">document.contentType</span> и, если это JSON, подменять
          вид документа. На всех остальных страницах скрипт немедленно выходит и ничего не читает.
          Ноль сети. Ничего никуда не отправляется. Никогда.
        </p>
        <Callout tone="warn">
          ⚠ FIREFOX: у Firefox есть свой встроенный JSON-просмотрщик, он перехватывает{' '}
          <span className="mono">application/json</span> раньше нас, и отключить его из расширения
          невозможно. Нужно вручную выставить{' '}
          <span className="mono">devtools.jsonview.enabled = false</span> в about:config. Мы не
          можем сделать это за вас и не будем притворяться, что можем.
        </Callout>
        <p className="fine">Отозвать доступ можно в любой момент здесь же.</p>
        <div className="row row--gap consent__actions">
          <Button onClick={() => dialog.current?.close()}>Отмена</Button>
          <Button variant="primary" onClick={() => void grant()}>
            Запросить доступ
          </Button>
        </div>
      </dialog>
    </Section>
  );
}

function EraseDocumentButton({ disabled }: { disabled: boolean }) {
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <div className="row row--gap">
      <Button
        disabled={disabled}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          void documentItem
            .removeValue()
            .then(() => setDone('Стёрто.'))
            .catch((err: unknown) =>
              setDone(
                `Не удалось стереть: ${err instanceof Error ? err.message : String(err)}`,
              ),
            );
          setArmed(false);
          setTimeout(() => setDone(null), 2500);
        }}
      >
        {armed ? 'Точно стереть?' : 'Стереть сохранённый документ'}
      </Button>
      <span className="fine" role="status" aria-live="polite">
        {done ?? ''}
      </span>
    </div>
  );
}

/* ----------------------------- layout helpers ----------------------------- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings__section">
      <h2 className="ui-section-heading">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="setrow">
      <span className="setrow__label">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="setrow setrow--toggle">
      <span>
        <span className="setrow__label">{label}</span>
        {hint && <span className="fine"> — {hint}</span>}
      </span>
      <input
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
