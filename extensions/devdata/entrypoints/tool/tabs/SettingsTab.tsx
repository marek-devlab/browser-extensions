import { useEffect, useRef, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { Badge, Button, Callout, LanguageSwitcher, type Locale } from '@blur/ui';
import {
  requestAllUrls,
  requestScripting,
  revokeAllUrls,
  usePermissionFact,
} from '../../../utils/permissions';
import { highlightSupported } from '../../../utils/highlight';
import { documentItem } from '../../../utils/storage';
import { useT } from '../../../utils/i18n';
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

export function SettingsTab({
  prefs,
  update,
  ready,
  error,
  retry,
  locale,
  setLocale,
}: PrefsApi & { locale: Locale; setLocale: (l: Locale) => void }) {
  const t = useT();
  const d = !ready;
  const [sourceAccess] = useState(hasSourceAccess);
  const [highlights] = useState(highlightSupported);

  return (
    <div className="settings">
      {!ready && error === null && <Callout tone="info">{t('settings.readingPrefs')}</Callout>}
      {error !== null && (
        <Callout tone="poor" title={t('settings.readFailTitle')}>
          {error}
          <div className="row row--gap">
            <Button onClick={retry}>{t('common.retry')}</Button>
          </div>
        </Callout>
      )}

      <Section title={t('settings.language')}>
        <LanguageSwitcher
          locale={locale}
          onChange={setLocale}
          label={t('settings.language')}
        />
      </Section>

      <Section title={t('settings.sectionView')}>
        <Row label={t('settings.indent')}>
          <select
            disabled={d}
            value={prefs?.indent ?? '2'}
            onChange={(e) => update({ indent: e.target.value as DevdataPrefs['indent'] })}
          >
            <option value="2">{t('settings.indent2')}</option>
            <option value="4">{t('settings.indent4')}</option>
            <option value="tab">{t('settings.indentTab')}</option>
            <option value="min">{t('settings.indentMin')}</option>
          </select>
        </Row>
        <Toggle
          label={t('settings.wrapLabel')}
          hint={t('settings.wrapHint')}
          disabled={d}
          checked={prefs?.wrap ?? true}
          onChange={(v) => update({ wrap: v })}
        />
        <Toggle
          label={t('settings.lineNumbers')}
          disabled={d}
          checked={prefs?.lineNumbers ?? true}
          onChange={(v) => update({ lineNumbers: v })}
        />
        <Row label={t('settings.startTab')}>
          <select
            disabled={d}
            value={prefs?.defaultTab ?? 'data'}
            onChange={(e) =>
              update({ defaultTab: e.target.value as DevdataPrefs['defaultTab'] })
            }
          >
            <option value="data">{t('tab.data')}</option>
            <option value="jwt">{t('tab.jwt')}</option>
            <option value="schema">{t('tab.schema')}</option>
          </select>
        </Row>
        {!highlights && (
          <Callout tone="warn">
            {t('settings.highlightWarn1')}
            <span className="mono">&lt;span&gt;</span>
            {t('settings.highlightWarn2')}
          </Callout>
        )}
      </Section>

      <Section title={t('settings.sectionParse')}>
        <Row label={t('settings.defaultFormat')}>
          <select
            disabled={d}
            value={prefs?.defaultFormat ?? 'auto'}
            onChange={(e) => update({ defaultFormat: e.target.value as FormatPref })}
          >
            <option value="auto">{t('settings.formatAuto')}</option>
            <option value="json">JSON</option>
            <option value="json5">JSON5</option>
            <option value="jsonc">JSONC</option>
            <option value="yaml">YAML</option>
            <option value="xml">XML</option>
            <option value="csv">CSV</option>
          </select>
        </Row>
        <Toggle
          label={t('settings.sortKeys')}
          hint={t('settings.sortKeysHint')}
          disabled={d}
          checked={prefs?.sortKeys ?? false}
          onChange={(v) => update({ sortKeys: v })}
        />
        <Row label={t('settings.expandTree')}>
          <select
            disabled={d}
            value={prefs?.expandDepth ?? 2}
            onChange={(e) => update({ expandDepth: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {t('settings.levels', { n })}
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
          <strong>{t('settings.exactTitle')}</strong>{' '}
          {sourceAccess ? t('settings.exactSupported') : t('settings.exactNotSupported')}{' '}
          {t('settings.exactBody1')}
          <span className="mono">12345678901234567890</span>
          {t('settings.exactBody2')}
        </Callout>

        <Row label={t('settings.csvDelimiter')}>
          <select
            disabled={d}
            value={prefs?.csvDelimiter ?? 'auto'}
            onChange={(e) =>
              update({ csvDelimiter: e.target.value as DevdataPrefs['csvDelimiter'] })
            }
          >
            <option value="auto">{t('settings.csvAuto')}</option>
            <option value="comma">{t('settings.csvComma')}</option>
            <option value="semicolon">{t('settings.csvSemicolon')}</option>
            <option value="tab">Tab</option>
          </select>
        </Row>
        <Toggle
          label={t('settings.csvBom')}
          hint={t('settings.csvBomHint')}
          disabled={d}
          checked={prefs?.csvBom ?? true}
          onChange={(v) => update({ csvBom: v })}
        />
      </Section>

      <Section title="JSON Schema">
        <Row label={t('settings.draft')}>
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
          label={t('settings.checkFormat')}
          hint={t('settings.checkFormatHint')}
          disabled={d}
          checked={prefs?.schemaFormats ?? false}
          onChange={(v) => update({ schemaFormats: v })}
        />
      </Section>

      <Section title={t('settings.sectionStorage')}>
        <Toggle
          label={t('settings.restore')}
          disabled={d}
          checked={prefs?.restore ?? true}
          onChange={(v) => update({ restore: v })}
        />
        <Callout tone="warn">
          {t('settings.storageWarn1')}
          <span className="mono">storage.local</span>
          {t('settings.storageWarn2')}
          <strong>{t('settings.storageNever')}</strong>
          {t('settings.storageWarn3')}
        </Callout>
        <EraseDocumentButton disabled={d} />
      </Section>

      <PageFormattingSection prefs={prefs} update={update} disabled={d} />

      <Section title={t('settings.sectionAbout')}>
        <p className="fine">{t('settings.aboutLine')}</p>
        <Callout tone="info">
          {t('settings.aboutNetwork1')}
          <span className="mono">fetch</span>
          {t('settings.aboutNetwork2')}
          <span className="mono">$ref</span>
          {t('settings.aboutNetwork3')}
        </Callout>
        <p className="fine">
          {t('settings.aboutLibs1')}
          <span className="mono">THIRD-PARTY-NOTICES.md</span>
          {t('settings.aboutLibs2')}
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
  const t = useT();
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
    setNote(ok ? t('settings.revokedNote') : t('settings.revokeFailedNote'));
    setTimeout(() => setNote(null), 4000);
  };

  return (
    <Section title={t('popup.pageFormatting')}>
      <div className="setrow">
        <div>
          <div className="setrow__label">{t('settings.formatOnClick')}</div>
          <div className="fine">{t('settings.formatOnClickNote')}</div>
        </div>
        {scripting === null ? (
          <span className="fine">{t('settings.checkingShort')}</span>
        ) : scripting ? (
          <Badge severity="ok">{t('settings.allowed')}</Badge>
        ) : (
          <Button disabled={disabled} onClick={() => void requestScripting()}>
            {t('settings.allow')}
          </Button>
        )}
      </div>

      <div className="setrow">
        <div>
          <div className="setrow__label">{t('settings.autoFormatJson')}</div>
          {allUrls === true ? (
            <div className="fine">{t('settings.autoGranted')}</div>
          ) : denied ? (
            <div className="fine">{t('popup.resultDenied')}</div>
          ) : (
            <div className="fine">{t('settings.autoNeedsAll')}</div>
          )}
        </div>
        {allUrls === true ? (
          <Button onClick={() => void revoke()}>{t('settings.revokeAccess')}</Button>
        ) : (
          <Button
            disabled={disabled || allUrls === null}
            onClick={() => {
              setDenied(false);
              dialog.current?.showModal();
            }}
          >
            {denied ? t('settings.tryAgain') : t('settings.enable')}
          </Button>
        )}
      </div>

      {note !== null && (
        <p className="fine" role="status">
          {note}
        </p>
      )}

      {allUrls === true && prefs?.autoFormat === false && (
        <Callout tone="warn">
          {t('settings.autoOffWarn')}
          <div className="row row--gap">
            <Button onClick={() => update({ autoFormat: true })}>
              {t('settings.enableAutoFormat')}
            </Button>
          </div>
        </Callout>
      )}

      <Callout tone="warn" title={t('settings.firefoxWinTitle')}>
        {t('settings.ffBody1')}
        <span className="mono">application/json</span>
        {t('settings.ffBody2')}
        <strong>{t('settings.ffImpossible')}</strong>
        {t('settings.ffBody3')}
        <span className="mono">about:config</span>
        {t('settings.ffBody4')}
        <span className="mono">devtools.jsonview.enabled</span>
        {t('settings.ffBody5')}
        <span className="mono">false</span>
        {t('settings.ffBody6')}
      </Callout>

      {/* The honest consent screen comes BEFORE the browser's prompt (§2.11).
          Native <dialog>: focus trap + ::backdrop for free. */}
      <dialog ref={dialog} className="consent">
        <h3>{t('settings.consentTitle')}</h3>
        <p>
          <strong>{t('settings.consentWhat')}</strong> {t('settings.consentWhatBody1')}
          <span className="mono">application/json</span>
          {t('settings.consentWhatBody2')}
        </p>
        <p>
          <strong>{t('settings.consentAsk')}</strong> {t('settings.consentAskBody')}
        </p>
        <p>
          <strong>{t('settings.consentWhy')}</strong> {t('settings.consentWhyBody')}
        </p>
        <p>
          <strong>{t('settings.consentDo')}</strong> {t('settings.consentDoBody1')}
          <span className="mono">document.contentType</span>
          {t('settings.consentDoBody2')}
        </p>
        <Callout tone="warn">
          {t('settings.consentFfWarn1')}
          <span className="mono">application/json</span>
          {t('settings.consentFfWarn2')}
          <span className="mono">devtools.jsonview.enabled = false</span>
          {t('settings.consentFfWarn3')}
        </Callout>
        <p className="fine">{t('settings.consentRevokeNote')}</p>
        <div className="row row--gap consent__actions">
          <Button onClick={() => dialog.current?.close()}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => void grant()}>
            {t('settings.consentRequestBtn')}
          </Button>
        </div>
      </dialog>
    </Section>
  );
}

function EraseDocumentButton({ disabled }: { disabled: boolean }) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
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
            .then(() => setDone(t('settings.erased')))
            .catch((err: unknown) =>
              setDone(
                t('settings.eraseFailed', {
                  message: err instanceof Error ? err.message : String(err),
                }),
              ),
            );
          setArmed(false);
          setTimeout(() => setDone(null), 2500);
        }}
      >
        {armed ? t('settings.eraseConfirm') : t('settings.eraseArm')}
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
