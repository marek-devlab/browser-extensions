import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Callout, MockBadge } from '@blur/ui';
import { usePermissionFact, requestScripting, requestAllUrls, revokeAllUrls } from '../../../utils/permissions';
import { registerAutoFormat } from '../../../utils/format-page';
import { documentItem } from '../../../utils/storage';
import type { DevdataPrefs, FormatPref } from '../../../utils/storage';

// The Settings tab — reached both from the in-app tab and the browser's
// "Options" menu item (which lands on `tool.html#/settings`, wxt.config.ts).
//
// Settings persistence is REAL: every control writes through `usePrefs().update`
// to `sync:prefs`. Controls are DISABLED until storage is read (`ready`), so the
// first click cannot overwrite a real setting with a default (design §5.7, §8).
// The permission rows read the FACT (`permissions.contains`), never a flag
// (design §3). What is stubbed is what a grant DOES (registerAutoFormat →
// todoLogic).

/** Runtime feature-detect for JSON.parse source access (design §5.6). The ES2026
 *  reviver context arg may be missing from the current lib types, so JSON.parse
 *  is cast to a reviver-tolerant signature rather than typed inline. */
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

export function SettingsTab({
  prefs,
  update,
  ready,
}: {
  prefs: DevdataPrefs | null;
  update: (patch: Partial<DevdataPrefs>) => void;
  ready: boolean;
}) {
  const d = ready ? false : true; // disable-all until prefs load
  const sourceAccess = hasSourceAccess();

  return (
    <div className="settings">
      <MockBadge />
      {!ready && (
        <Callout tone="info">Читаем настройки… контролы заблокированы до загрузки.</Callout>
      )}

      <Section title="Вид">
        <Row label="Отступ">
          <select disabled={d} value={prefs?.indent ?? '2'} onChange={(e) => update({ indent: e.target.value as DevdataPrefs['indent'] })}>
            <option value="2">2 пробела</option>
            <option value="4">4 пробела</option>
            <option value="tab">Tab</option>
            <option value="min">Minified</option>
          </select>
        </Row>
        <Toggle label="Перенос длинных строк" disabled={d} checked={prefs?.wrap ?? true} onChange={(v) => update({ wrap: v })} />
        <Toggle label="Показывать номера строк" disabled={d} checked={prefs?.lineNumbers ?? true} onChange={(v) => update({ lineNumbers: v })} />
        <Row label="Стартовый таб">
          <select disabled={d} value={prefs?.defaultTab ?? 'data'} onChange={(e) => update({ defaultTab: e.target.value as DevdataPrefs['defaultTab'] })}>
            <option value="data">Данные</option>
            <option value="jwt">JWT</option>
            <option value="schema">Схема</option>
          </select>
        </Row>
      </Section>

      <Section title="Разбор">
        <Row label="Формат по умолчанию">
          <select disabled={d} value={prefs?.defaultFormat ?? 'auto'} onChange={(e) => update({ defaultFormat: e.target.value as FormatPref })}>
            <option value="auto">Автоопределение</option>
            <option value="json">JSON</option>
            <option value="json5">JSON5</option>
            <option value="jsonc">JSONC</option>
            <option value="yaml">YAML</option>
            <option value="xml">XML</option>
            <option value="csv">CSV</option>
          </select>
        </Row>
        <Toggle label="Сортировать ключи (только вывод)" disabled={d} checked={prefs?.sortKeys ?? false} onChange={(v) => update({ sortKeys: v })} />
        <Row label="Разворачивать дерево до">
          <select disabled={d} value={prefs?.expandDepth ?? 2} onChange={(e) => update({ expandDepth: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n} уровней</option>
            ))}
          </select>
        </Row>
        <Toggle
          label="Точные большие числа"
          hint={sourceAccess ? 'Показывать 12345678901234567890 как есть.' : '⚠ Недоступно в этой версии браузера (нет JSON.parse source access).'}
          disabled={d || !sourceAccess}
          checked={sourceAccess ? (prefs?.exactNumbers ?? true) : false}
          onChange={(v) => update({ exactNumbers: v })}
        />
        <Row label="Разделитель CSV">
          <select disabled={d} value={prefs?.csvDelimiter ?? 'auto'} onChange={(e) => update({ csvDelimiter: e.target.value as DevdataPrefs['csvDelimiter'] })}>
            <option value="auto">авто</option>
            <option value="comma">запятая ,</option>
            <option value="semicolon">точка с запятой ;</option>
            <option value="tab">Tab</option>
          </select>
        </Row>
        <Toggle label="BOM при экспорте CSV" hint="Без BOM Excel ломает кириллицу." disabled={d} checked={prefs?.csvBom ?? true} onChange={(v) => update({ csvBom: v })} />
        <Row label="Драфт JSON Schema">
          <select disabled={d} value={prefs?.schemaDraft ?? '2020-12'} onChange={(e) => update({ schemaDraft: e.target.value as DevdataPrefs['schemaDraft'] })}>
            <option value="2020-12">2020-12</option>
            <option value="2019-09">2019-09</option>
            <option value="7">7</option>
            <option value="4">4</option>
          </select>
        </Row>
        <Toggle label="Проверять format:" hint="Спецификация делает format аннотацией, а не ограничением." disabled={d} checked={prefs?.schemaFormats ?? false} onChange={(v) => update({ schemaFormats: v })} />
      </Section>

      <Section title="Хранение">
        <Toggle label="Восстанавливать последний документ" disabled={d} checked={prefs?.restore ?? true} onChange={(v) => update({ restore: v })} />
        <Callout tone="warn">
          ⚠ Сохраняется только в этом браузере, до 1 МБ. Документы больше 1 МБ не сохраняются.
          Содержимое таба JWT не сохраняется НИКОГДА.
        </Callout>
        <EraseDocumentButton disabled={d} />
      </Section>

      <PageFormattingSection prefs={prefs} update={update} disabled={d} />

      <Section title="О расширении">
        <p className="fine">Версия 1.0.0 · Ноль сети · Ноль аналитики · Открытый код</p>
        <Button>Лицензии зависимостей</Button>
      </Section>
    </div>
  );
}

/* ---------------- Page-formatting (permission facts + consent dialog) --------- */

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [denied, setDenied] = useState(false);

  // Keep the stubbed content-script registration in sync with the FACT: register
  // when granted, and the design requires unregistering on external revoke (§8).
  useEffect(() => {
    if (allUrls === true) void registerAutoFormat();
  }, [allUrls]);

  const grantAllUrls = async () => {
    const ok = await requestAllUrls();
    // The toggle MUST fall back to "off" on refusal — an optimistic toggle that
    // stayed on would be a lie (design §2.11).
    setDenied(!ok);
    dialogRef.current?.close();
  };

  return (
    <Section title="Форматирование страниц">
      <div className="setrow">
        <div>
          <div className="setrow__label">Форматировать по клику</div>
          <div className="fine">Разово, только текущая вкладка. Доступ к сайтам не выдаётся.</div>
        </div>
        {scripting ? (
          <Badge severity="ok">✓ Разрешено</Badge>
        ) : (
          <Button disabled={disabled} onClick={() => void requestScripting()}>Разрешить</Button>
        )}
      </div>

      <div className="setrow">
        <div>
          <div className="setrow__label">Авто-формат JSON-страниц</div>
          {allUrls === true ? (
            <div className="fine">✓ Доступ выдан. ⚠ Firefox: конфликт со встроенным просмотрщиком не устранён.</div>
          ) : denied ? (
            <div className="fine">Доступ не выдан — фича не работает. Всё остальное работает как работало.</div>
          ) : (
            <div className="fine">⚠ Требует доступа ко всем сайтам. Подробности — по кнопке.</div>
          )}
        </div>
        {allUrls === true ? (
          <Button onClick={() => void revokeAllUrls()}>Отозвать доступ</Button>
        ) : (
          <Button
            disabled={disabled || allUrls === null}
            onClick={() => {
              update({ autoFormat: true }); // store the INTENT
              setDenied(false);
              dialogRef.current?.showModal();
            }}
          >
            {denied ? 'Попробовать снова' : 'Включить'}
          </Button>
        )}
      </div>

      {/* Honest consent screen BEFORE the browser prompt (design §2.11). Native
          <dialog> gives focus-trap + ::backdrop for free. */}
      <dialog ref={dialogRef} className="consent">
        <h3>Авто-форматирование JSON-страниц</h3>
        <p><strong>Что это даёт.</strong> Открывая URL, отдающий application/json, расширение само покажет его деревом — без клика по иконке.</p>
        <p><strong>Что браузер спросит.</strong> «Читать и изменять все ваши данные на всех веб-сайтах». Это единственная формулировка, которую даёт Chrome.</p>
        <p><strong>Что мы будем делать.</strong> Ровно одно: на document_start проверять document.contentType и, если это JSON, подменять вид. На всех остальных страницах скрипт немедленно выходит. Ноль сети.</p>
        <Callout tone="warn">
          ⚠ FIREFOX: встроенный JSON-просмотрщик перехватывает application/json раньше нас, и
          отключить его из расширения нельзя. Нужно вручную выставить
          <span className="mono"> devtools.jsonview.enabled = false</span> в about:config.
        </Callout>
        <div className="row row--gap consent__actions">
          <Button onClick={() => { update({ autoFormat: false }); dialogRef.current?.close(); }}>Отмена</Button>
          <Button variant="primary" onClick={() => void grantAllUrls()}>Запросить доступ</Button>
        </div>
      </dialog>
    </Section>
  );
}

function EraseDocumentButton({ disabled }: { disabled: boolean }) {
  // Two-step confirm (house convention: adblock "Reset statistics", design §3).
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
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
          void documentItem.removeValue();
          setArmed(false);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {armed ? 'Точно стереть?' : 'Стереть сохранённый документ'}
      </Button>
      <span className="fine" role="status" aria-live="polite">{done ? 'Стёрто.' : ''}</span>
    </div>
  );
}

/* ---------------- Small layout helpers ---------------- */

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
      <input type="checkbox" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
