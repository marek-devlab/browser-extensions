import { useEffect, useState } from 'react';
import { browser } from '#imports';
import type { VitalRating, WebVital } from '@blur/core';
import { formatVital, rateVital } from '@blur/core';
import {
  hasQueryOrFragment,
  isAuditableUrl,
  runPsiAudit,
  stripToOriginPath,
} from '../../utils/psi';
import type { PsiAuditResult, PsiStrategy } from '../../utils/psi';
import type { CruxFieldMetric } from '../../utils/perf-types';
import { psiConfigItem } from '../../utils/storage';
import { useT, type TFn } from '../../utils/i18n';

// PageSpeed Insights section (PLAN.md §9/§14). Lighthouse cannot be bundled;
// this is the allowed REST *data* path. Two hard rules surfaced in the UI:
//   - PSI sends the page URL to Google — disclosed and acknowledged BEFORE the
//     first call.
//   - The API key is stored in storage.local, never sync (see utils/storage.ts).

export function AuditPanel() {
  const t = useT();
  const [apiKey, setApiKey] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const [strategy, setStrategy] = useState<PsiStrategy>('mobile');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PsiAuditResult | null>(null);

  useEffect(() => {
    void psiConfigItem.getValue().then((cfg) => {
      setApiKey(cfg.apiKey);
      setAccepted(cfg.disclosureAccepted);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    browser.devtools.inspectedWindow.eval('location.href', (result: unknown) => {
      if (typeof result === 'string') setUrl(result);
    });
  }, []);

  async function persist(next: { apiKey?: string; disclosureAccepted?: boolean }) {
    const cfg = await psiConfigItem.getValue();
    await psiConfigItem.setValue({ ...cfg, ...next });
  }

  function onKeyChange(value: string) {
    setApiKey(value);
    void persist({ apiKey: value });
  }

  function onAccept() {
    setAccepted(true);
    void persist({ disclosureAccepted: true });
  }

  // Withdraw consent: clears the persisted flag so the disclosure gate shows
  // again before the next PSI call (audit B2 — consent must be revocable).
  function onRevoke() {
    setAccepted(false);
    void persist({ disclosureAccepted: false });
  }

  // One-click "domain and path only": rewrite the field to origin + pathname,
  // dropping query and fragment. Surfaced, never silent (audit B1).
  function onStripQuery() {
    setUrl((current) => stripToOriginPath(current));
  }

  const verdict = isAuditableUrl(url);
  const hasParams = hasQueryOrFragment(url);

  async function run() {
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      // Host access for the PSI endpoint is requested at runtime (this click is a
      // user gesture) rather than at install — keeps the base permission set narrow.
      const granted = await browser.permissions.request({
        origins: ['https://www.googleapis.com/*'],
      });
      if (!granted) {
        setError(t('auErrHostAccess'));
        return;
      }
      setResult(await runPsiAudit(url, apiKey || undefined, strategy));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auErrPsiFailed'));
    } finally {
      setRunning(false);
    }
  }

  if (!loaded) return <p className="note">{t('loading')}</p>;

  return (
    <section>
      <p className="note">
        {t('auIntro1')}
        <strong>{t('auIntroStrong')}</strong>
        {t('auIntro2')}
      </p>

      <label className="field">
        <span className="field__label">{t('auApiKeyLabel')}</span>
        <input
          className="field__input mono"
          type="password"
          value={apiKey}
          placeholder="AIza…"
          onChange={(e) => onKeyChange(e.target.value)}
        />
        <span className="field__hint">
          {t('auApiKeyHint1')}
          <code>storage.local</code>
          {t('auApiKeyHint2')}
        </span>
      </label>

      <label className="field">
        <span className="field__label">{t('auUrlLabel')}</span>
        <input
          className="field__input mono"
          type="url"
          value={url}
          disabled={running}
          placeholder="https://example.com/page"
          onChange={(e) => setUrl(e.target.value)}
        />
        <span className="field__hint">
          {t('auUrlHint1')}
          <strong>{t('auUrlHintStrong')}</strong>
          {t('auUrlHint2')}
          <code>?</code>
          {t('auUrlHint3')}
          <code>#</code>
          {t('auUrlHint4')}
        </span>
      </label>

      {hasParams && (
        <p className="note" role="alert">
          {t('auHasParams')}
          <button className="btn btn--sm" type="button" disabled={running} onClick={onStripQuery}>
            {t('auDomainPathOnly')}
          </button>
        </p>
      )}

      <fieldset className="strategy" disabled={running}>
        <legend className="strategy__legend">{t('auDevice')}</legend>
        {(['mobile', 'desktop'] as PsiStrategy[]).map((s) => (
          <label key={s} className="strategy__option">
            <input
              type="radio"
              name="psi-strategy"
              value={s}
              checked={strategy === s}
              onChange={() => setStrategy(s)}
            />
            <span>{s === 'mobile' ? t('auMobile') : t('auDesktop')}</span>
          </label>
        ))}
      </fieldset>

      {!verdict.ok && <p className="note" role="alert">{verdict.reason}</p>}

      {!accepted ? (
        <div className="confirm" role="alertdialog" aria-label={t('auDisclosureAria')}>
          <p className="confirm__body">
            <strong>{t('auDiscTitle')}</strong>
          </p>
          <p className="confirm__body">
            {t('auDisc2a')}
            <strong>{t('auDisc2bStrong')}</strong>
            {t('auDisc2c')}
            <code>www.googleapis.com</code>
            {t('auDisc2d')}
          </p>
          <p className="confirm__body">
            {t('auDisc3a')}
            <strong>{t('auDisc3bStrong')}</strong>
            {t('auDisc3c')}
          </p>
          <p className="confirm__body">
            {t('auDisc4a')}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('auDisc4Link')}
            </a>
            {t('auDisc4b')}
          </p>
          <div className="confirm__actions">
            <button className="btn btn--primary" onClick={onAccept}>
              {t('auAccept')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button className="btn btn--primary" disabled={running || !verdict.ok} onClick={run}>
            {running ? t('auAuditing') : t('auRunAudit')}
          </button>
          <p className="field__hint">
            {t('auAccepted')}
            <button className="btn-link" type="button" disabled={running} onClick={onRevoke}>
              {t('auRevoke')}
            </button>
          </p>
        </>
      )}

      {error && <p className="note" role="alert">{error}</p>}

      {result && (
        <div className="audit-result" role="status" aria-live="polite">
          <div className="score">
            <span className="score__value mono">
              {result.performanceScore === null ? '—' : result.performanceScore}
            </span>
            <span className="score__label">
              {result.performanceScore === null
                ? t('auScoreUnavailable')
                : t('auScore')}
            </span>
          </div>
          <div className="cards">
            {result.vitals.map((v: WebVital) => {
              const rating = rateVital(v.name, v.value);
              return (
                <article key={v.name} className={`card rating--${rating}`}>
                  <header className="card__name">{v.name}</header>
                  <div className="card__value mono">{formatVital(v)}</div>
                  <div className="card__rating">{ratingLabel(t, rating)}</div>
                </article>
              );
            })}
          </div>
          <p className="note">{t('auLabData', { strategy: result.strategy })}</p>

          <FieldData label={t('auFieldUrl')} metrics={result.field.url} />
          <FieldData label={t('auFieldOrigin')} metrics={result.field.origin} />
          {result.field.url.length === 0 && result.field.origin.length === 0 && (
            <p className="note">{t('auNoCrux')}</p>
          )}
        </div>
      )}
    </section>
  );
}

function formatField(m: CruxFieldMetric): string {
  if (m.unit === 'score') return m.p75.toFixed(3);
  if (m.p75 >= 1000) return `${(m.p75 / 1000).toFixed(2)} s`;
  return `${Math.round(m.p75)} ms`;
}

function FieldData({ label, metrics }: { label: string; metrics: CruxFieldMetric[] }) {
  const t = useT();
  if (metrics.length === 0) return null;
  return (
    <div className="field-data">
      <h3 className="field-data__title">{label}</h3>
      <div className="cards">
        {metrics.map((m) => (
          <article key={m.name} className={`card rating--${m.rating}`}>
            <header className="card__name">{m.name}</header>
            <div className="card__value mono">{formatField(m)}</div>
            <div className="card__rating">{ratingLabel(t, m.rating)}</div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ratingLabel(t: TFn, rating: VitalRating): string {
  if (rating === 'good') return t('ratingGood');
  if (rating === 'needs-improvement') return t('ratingNi');
  return t('ratingPoor');
}
