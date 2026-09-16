import { useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { Callout, LanguageSwitcher, SectionHeading, ThemeToggle } from '@blur/ui';
import { downloadText, fileStamp } from '../../../utils/download';
import { useT } from '../../../utils/i18n';
import { LOG_SIZES, type LogSize } from '../../../utils/log';
import { sendQuery } from '../../../utils/messaging';
import type { PermissionStatus } from '../../../utils/protocol';
import type { PrefsApi } from '../../../utils/prefs';
import { parseRulesImport, type RuleError } from '../../../utils/rule-schema';
import { LIMITS } from '../../../utils/rule-types';
import type { RulesStore } from '../../../utils/use-rules';

// Design §2.6. Every control here is the ONE writer for its pref (usePrefs);
// import goes through `parseRulesImport` for the §4.5 preview and then to the
// background, which validates AGAIN (the preview is not trusted). "Delete all"
// is a two-step confirm (house convention). The access list shows the FACT
// (`permissions.getAll`) — not an intention stored in prefs (§3 ⚠️).

interface ImportPreview {
  text: string;
  ok: number;
  errors: RuleError[];
}

export function SettingsPage({
  prefs,
  store,
  permissions,
  refreshPermissions,
  platform,
}: {
  prefs: PrefsApi;
  store: RulesStore;
  permissions: PermissionStatus | null;
  refreshPermissions: () => void;
  platform: 'chrome' | 'firefox';
}) {
  const t = useT();
  const p = prefs.prefs;
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importError, setImportError] = useState('');

  const ruleCount = store.doc?.rules.length ?? 0;

  async function exportRules(): Promise<void> {
    const r = await sendQuery({ type: 'exportRules' });
    if (!r || !('text' in r)) return;
    downloadText(`request-blocker-rules-${fileStamp()}.json`, r.text, 'application/json');
    setNotice(t('stExported', { n: ruleCount }));
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setImportError('');
    if (file.size > LIMITS.importBytes) {
      setImportError(`file larger than ${LIMITS.importBytes} bytes`);
      return;
    }
    const text = await file.text();
    const v = parseRulesImport(text);
    setPreview({ text, ok: v.doc.rules.length, errors: v.errors });
  }

  async function importValid(): Promise<void> {
    if (!preview) return;
    const r = await sendQuery({ type: 'importRules', text: preview.text, mode: 'merge' });
    if (r && 'imported' in r) {
      setNotice(t('stImportDone', { n: r.imported }));
      if (!r.ok && r.imported === 0) setImportError(r.errors.map((e) => e.message).join('; '));
    }
    setPreview(null);
    await store.reload();
  }

  const isChrome = platform === 'chrome';

  return (
    <section className="settings">
      <SectionHeading>{t('stGeneral')}</SectionHeading>
      <div className="row row--gap">
        <span className="field">{t('settingsTheme')}</span>
        <ThemeToggle theme={p?.theme ?? 'auto'} onChange={(theme) => prefs.update({ theme })} />
      </div>
      <div className="row row--gap">
        <span className="field">{t('interfaceLanguage')}</span>
        <LanguageSwitcher locale={p?.locale ?? 'en'} onChange={(locale) => prefs.update({ locale })} label={t('interfaceLanguage')} />
      </div>

      <SectionHeading>{t('stLog')}</SectionHeading>
      <div className="row row--gap">
        <label className="field">
          {t('settingsLogSize')}
          <select value={p?.logSize ?? 2000} disabled={!p} onChange={(e) => prefs.update({ logSize: Number(e.target.value) as LogSize })}>
            {LOG_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" data-testid="strip-query" checked={p?.logStripQuery ?? false} disabled={!p} onChange={(e) => prefs.update({ logStripQuery: e.target.checked })} />
          {t('settingsStripQuery')} <span className="fine">ⓘ {t('settingsStripQueryHint')}</span>
        </label>
      </div>

      {isChrome ? (
        <>
          <SectionHeading>{t('stEngines')}</SectionHeading>
          <label className="check">
            <input type="checkbox" data-testid="page-engine" checked={p?.pageEngineEnabled ?? true} disabled={!p} onChange={(e) => prefs.update({ pageEngineEnabled: e.target.checked })} />
            {t('settingsPageEngine')}
          </label>
          <p className="fine">{t('settingsPageEngineHint')}</p>
          {permissions?.debuggerAvailable ? (
            <label className="check">
              <input type="checkbox" checked={p?.nlSticky ?? false} disabled={!p} onChange={(e) => prefs.update({ nlSticky: e.target.checked })} />
              {t('stNlSticky')}
            </label>
          ) : null}
        </>
      ) : null}

      <SectionHeading>{t('stData')}</SectionHeading>
      <div className="row row--gap">
        <button type="button" className="ui-btn" onClick={() => void exportRules()} disabled={ruleCount === 0}>
          {t('settingsExport')}
        </button>
        <button type="button" className="ui-btn" onClick={() => fileRef.current?.click()} data-testid="import-btn">
          {t('settingsImport')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          data-testid="import-file"
          aria-label={t('settingsImport')}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="ui-btn"
          onClick={() => void sendQuery({ type: 'resetCounters' }).then(() => setNotice(t('stCountersReset')))}
        >
          {t('settingsResetCounters')}
        </button>
      </div>
      {importError ? (
        <p className="fine warn" role="alert">
          {t('stImportFailed')} {importError}
        </p>
      ) : null}

      {preview ? (
        <div className="ui-callout ui-callout--info import" role="region" aria-label={t('stImportTitle')} data-testid="import-preview">
          <p className="ui-callout__title">{t('stImportTitle')}</p>
          <div className="ui-callout__body">
            <p data-testid="import-summary">{t('stImportSummary', { ok: preview.ok, bad: new Set(preview.errors.map((e) => `${e.where}:${e.index}`)).size })}</p>
            {preview.errors.length > 0 ? (
              <div className="log__scroll">
                <table className="errors" data-testid="import-errors">
                  <thead>
                    <tr>
                      <th>{t('stImportColIndex')}</th>
                      <th>{t('stImportColField')}</th>
                      <th>{t('stImportColMessage')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.errors.map((e, i) => (
                      <tr key={i}>
                        <td className="mono">{e.index === null ? t('stDocument') : `${e.where} ${e.index + 1}`}</td>
                        <td className="mono">{e.path || '—'}</td>
                        <td>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p>{t('stImportMode')}</p>
            <div className="row row--gap">
              <button type="button" className="ui-btn ui-btn--primary" disabled={preview.ok === 0} onClick={() => void importValid()} data-testid="import-valid">
                {preview.ok === 0 ? t('stImportNone') : t('stImportValid', { n: preview.ok })}
              </button>
              <button type="button" className="ui-btn" onClick={() => setPreview(null)}>
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="row row--gap">
        {confirmDelete ? (
          <>
            <span className="fine">{t('stDeleteAllConfirm', { n: ruleCount })}</span>
            <button type="button" className="ui-btn" onClick={() => setConfirmDelete(false)}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className="ui-btn btn-danger"
              data-testid="delete-all-confirm"
              onClick={() => {
                setConfirmDelete(false);
                void store.deleteAllRules().then((r) => r.ok && setNotice(t('stDeleted')));
              }}
            >
              {t('stDeleteAllReally')}
            </button>
          </>
        ) : (
          <button type="button" className="ui-btn ui-btn--ghost" disabled={ruleCount === 0} onClick={() => setConfirmDelete(true)} data-testid="delete-all">
            {t('settingsDeleteAll')}
          </button>
        )}
      </div>

      <SectionHeading>{t('stAccess')}</SectionHeading>
      <p className="field">{t('stSites')}</p>
      {permissions === null ? (
        <p className="fine">{t('loading')}</p>
      ) : permissions.origins.length === 0 ? (
        <p className="fine">{t('stNoSites')}</p>
      ) : (
        <ul className="sites">
          {permissions.origins.map((o) => (
            <li key={o} className="sites__item mono">
              {o === '<all_urls>' ? t('stAllSites') : o}
              {o !== '<all_urls>' ? (
                <button
                  type="button"
                  className="linkish"
                  aria-label={t('stRemoveAccess', { origin: o })}
                  title={t('stRemoveAccess', { origin: o })}
                  onClick={() =>
                    void browser.permissions
                      .remove({ origins: [o] })
                      .then(() => sendQuery({ type: 'siteAccessChanged' }))
                      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)))
                      .finally(refreshPermissions)
                  }
                >
                  ✕
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {isChrome ? (
        // `debugger` is an install-time permission Chrome refuses to make
        // optional (wxt.config.ts), so there is nothing to grant or revoke here
        // — only the truth: it is opt-in per tab, from the popup.
        <p className="fine" data-testid="nl-permission">
          {t('stNlPermission')}: {permissions?.debuggerAvailable ? t('stNlInstallTime') : t('puNlUnavailable')}
        </p>
      ) : null}

      <Callout>{t('settingsRulesAreData')}</Callout>

      <output className="fine" aria-live="polite" data-testid="settings-live">
        {notice}
      </output>
      {prefs.error ? (
        <p className="fine warn" role="alert">
          {prefs.error}
        </p>
      ) : null}
    </section>
  );
}
