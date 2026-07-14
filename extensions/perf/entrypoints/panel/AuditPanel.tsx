import { useEffect, useState } from 'react';
import { browser } from '#imports';
import type { VitalRating, WebVital } from '@blur/core';
import { formatVital, rateVital } from '@blur/core';
import { isAuditableUrl, runPsiAudit } from '../../utils/psi';
import type { PsiAuditResult, PsiStrategy } from '../../utils/psi';
import type { CruxFieldMetric } from '../../utils/perf-types';
import { psiConfigItem } from '../../utils/storage';

// PageSpeed Insights section (PLAN.md §9/§14). Lighthouse cannot be bundled;
// this is the allowed REST *data* path. Two hard rules surfaced in the UI:
//   - PSI sends the page URL to Google — disclosed and acknowledged BEFORE the
//     first call.
//   - The API key is stored in storage.local, never sync (see utils/storage.ts).

export function AuditPanel() {
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

  const verdict = isAuditableUrl(url);

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
        setError('Host access to googleapis.com was not granted.');
        return;
      }
      setResult(await runPsiAudit(url, apiKey || undefined, strategy));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PSI request failed.');
    } finally {
      setRunning(false);
    }
  }

  if (!loaded) return <p className="note">Loading…</p>;

  return (
    <section>
      <p className="note">
        PageSpeed Insights runs Lighthouse on Google's servers and returns lab +
        field data. Lighthouse itself cannot be bundled (Node app; MV3 bans remote
        code), so this is the realistic path. <strong>Running an audit sends this
        page's URL to Google.</strong> Public URLs only — localhost and pages behind
        auth are unreachable.
      </p>

      <label className="field">
        <span className="field__label">Google API key (optional, recommended)</span>
        <input
          className="field__input mono"
          type="password"
          value={apiKey}
          placeholder="AIza…"
          onChange={(e) => onKeyChange(e.target.value)}
        />
        <span className="field__hint">
          Stored in <code>storage.local</code>, never synced. Limits without a key:
          ~25,000/day, 400 per 100&nbsp;s.
        </span>
      </label>

      <div className="audit-url mono" title={url}>{url || '—'}</div>

      <fieldset className="strategy" disabled={running}>
        <legend className="strategy__legend">Device</legend>
        {(['mobile', 'desktop'] as PsiStrategy[]).map((s) => (
          <label key={s} className="strategy__option">
            <input
              type="radio"
              name="psi-strategy"
              value={s}
              checked={strategy === s}
              onChange={() => setStrategy(s)}
            />
            <span>{s === 'mobile' ? 'Mobile' : 'Desktop'}</span>
          </label>
        ))}
      </fieldset>

      {!verdict.ok && <p className="note" role="alert">{verdict.reason}</p>}

      {!accepted ? (
        <div className="confirm" role="alertdialog" aria-label="PSI disclosure">
          <p className="confirm__body">
            To audit, you must acknowledge that the page URL will be sent to Google's
            PageSpeed Insights API.
          </p>
          <div className="confirm__actions">
            <button className="btn btn--primary" onClick={onAccept}>
              I understand — send the URL to Google
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn--primary" disabled={running || !verdict.ok} onClick={run}>
          {running ? 'Auditing…' : 'Run PageSpeed audit'}
        </button>
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
                ? 'Performance score unavailable'
                : 'Performance score'}
            </span>
          </div>
          <div className="cards">
            {result.vitals.map((v: WebVital) => {
              const rating = rateVital(v.name, v.value);
              return (
                <article key={v.name} className={`card rating--${rating}`}>
                  <header className="card__name">{v.name}</header>
                  <div className="card__value mono">{formatVital(v)}</div>
                  <div className="card__rating">{ratingLabel(rating)}</div>
                </article>
              );
            })}
          </div>
          <p className="note">Lab data via PSI, strategy: {result.strategy}.</p>

          <FieldData label="Field data — this URL (CrUX, real users, p75)" metrics={result.field.url} />
          <FieldData label="Field data — whole origin (CrUX, real users, p75)" metrics={result.field.origin} />
          {result.field.url.length === 0 && result.field.origin.length === 0 && (
            <p className="note">
              No CrUX field data: this page/origin doesn't have enough real-user
              samples in the Chrome UX Report. Lab data above still applies.
            </p>
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
  if (metrics.length === 0) return null;
  return (
    <div className="field-data">
      <h3 className="field-data__title">{label}</h3>
      <div className="cards">
        {metrics.map((m) => (
          <article key={m.name} className={`card rating--${m.rating}`}>
            <header className="card__name">{m.name}</header>
            <div className="card__value mono">{formatField(m)}</div>
            <div className="card__rating">{ratingLabel(m.rating)}</div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ratingLabel(rating: VitalRating): string {
  if (rating === 'good') return 'Good';
  if (rating === 'needs-improvement') return 'Needs improvement';
  return 'Poor';
}
