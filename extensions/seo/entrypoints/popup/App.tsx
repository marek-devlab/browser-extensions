import { useCallback, useEffect, useState } from 'react';
import type { A11yImpact, A11yReport } from '@blur/core';
import { impactRank, type SeoReportEx } from '../../utils/checks';
import { reportToJson, reportToMarkdown } from '../../utils/export';
import {
  activeTabId,
  requestA11yAudit,
  requestSeoReport,
} from '../../utils/messages';
import { ThemeToggle, usePanelPrefs } from '../../utils/theme';

// Compact at-a-glance card for the current page. The SEO summary loads on open
// (through the always-on content script — no gesture needed); the accessibility
// audit runs only when the user presses the button, since a full axe pass is too
// costly to run automatically.

const IMPACT_ORDER: A11yImpact[] = ['critical', 'serious', 'moderate', 'minor'];

type Async<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; error: string };

export function App() {
  const [seo, setSeo] = useState<Async<SeoReportEx>>({ status: 'loading' });
  const [a11y, setA11y] = useState<Async<A11yReport>>({ status: 'idle' });
  const [copied, setCopied] = useState<string | null>(null);
  const { prefs, update } = usePanelPrefs();

  // Clear the "Copied…" status after a moment so it does not linger forever.
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    void (async () => {
      const id = await activeTabId();
      if (id === null) {
        setSeo({ status: 'error', error: 'No active tab.' });
        return;
      }
      const outcome = await requestSeoReport(id);
      setSeo(
        outcome.ok
          ? { status: 'ready', value: outcome.data }
          : { status: 'error', error: outcome.error },
      );
    })();
  }, []);

  const runAudit = useCallback(async () => {
    setA11y({ status: 'loading' });
    const id = await activeTabId();
    if (id === null) {
      setA11y({ status: 'error', error: 'No active tab.' });
      return;
    }
    const outcome = await requestA11yAudit(id);
    setA11y(
      outcome.ok
        ? { status: 'ready', value: outcome.data }
        : { status: 'error', error: outcome.error },
    );
  }, []);

  const copyReport = useCallback(
    async (format: 'json' | 'markdown') => {
      if (seo.status !== 'ready') return;
      const a11yValue = a11y.status === 'ready' ? a11y.value : null;
      const text =
        format === 'json'
          ? reportToJson(seo.value, a11yValue)
          : reportToMarkdown(seo.value, a11yValue);
      try {
        await navigator.clipboard.writeText(text);
        setCopied(`Copied as ${format === 'json' ? 'JSON' : 'Markdown'}.`);
      } catch {
        setCopied('Could not copy to the clipboard.');
      }
    },
    [seo, a11y],
  );

  return (
    <div className="popup">
      <header className="head">
        <h1>SEO &amp; A11y</h1>
        <span className="host mono">
          {/* The audited page's own host — NOT the canonical, which can point at
              another domain and would mislabel the header. */}
          {seo.status === 'ready' ? hostOf(seo.value.url) : 'this page'}
        </span>
        <ThemeToggle
          theme={prefs?.theme ?? 'auto'}
          onChange={(theme) => update({ theme })}
        />
      </header>

      <div role="status" aria-live="polite">
        {seo.status === 'loading' && (
          <p className="state">
            <span className="spinner" /> Reading the page…
          </p>
        )}
        {seo.status === 'error' && (
          <p className="state state--error">{seo.error}</p>
        )}
      </div>
      {seo.status === 'ready' && <SeoSummary report={seo.value} />}

      <section>
        <h2>Accessibility</h2>
        {a11y.status === 'idle' && (
          <p className="foot" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
            Run axe-core against this page to list violations by impact.
          </p>
        )}
        <div role="status" aria-live="polite">
          {a11y.status === 'loading' && (
            <p className="state">
              <span className="spinner" /> Auditing with axe-core…
            </p>
          )}
          {a11y.status === 'error' && (
            <p className="state state--error">{a11y.error}</p>
          )}
        </div>
        {a11y.status === 'ready' && <A11ySummary report={a11y.value} />}

        <button
          className="btn"
          onClick={() => void runAudit()}
          disabled={a11y.status === 'loading'}
          aria-label="Run the axe-core accessibility audit on this page"
        >
          {a11y.status === 'loading' ? 'Running…' : 'Run accessibility audit'}
        </button>
      </section>

      <section>
        <h2>Export</h2>
        <div className="export-row">
          <button
            className="btn btn--sm"
            onClick={() => void copyReport('json')}
            disabled={seo.status !== 'ready'}
            aria-label="Copy report as JSON to the clipboard"
          >
            Copy JSON
          </button>
          <button
            className="btn btn--sm"
            onClick={() => void copyReport('markdown')}
            disabled={seo.status !== 'ready'}
            aria-label="Copy report as Markdown to the clipboard"
          >
            Copy Markdown
          </button>
        </div>
        <p className="foot" role="status" aria-live="polite" style={{ marginTop: 6, borderTop: 'none', paddingTop: 0 }}>
          {copied}
        </p>
      </section>

      <footer className="foot">
        {/* The panel is only reachable with DevTools open (F12). */}
        Open the SEO &amp; A11y panel (F12 → "SEO &amp; A11y") for full detail.
      </footer>
    </div>
  );
}

function SeoSummary({ report }: { report: SeoReportEx }) {
  const errors = report.checks.filter((c) => c.severity === 'error').length;
  const warnings = report.checks.filter((c) => c.severity === 'warning').length;

  return (
    <>
      <section>
        <h2>Meta</h2>
        <ul className="presence">
          <PresenceRow label="Title" present={report.title !== null} />
          <PresenceRow label="Description" present={report.description !== null} />
          <PresenceRow label="Canonical" present={report.canonical !== null} />
        </ul>
      </section>

      <div className="stats">
        <Stat
          label="SEO errors"
          value={errors}
          severity={errors > 0 ? 'poor' : undefined}
        />
        <Stat
          label="SEO warnings"
          value={warnings}
          severity={warnings > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Imgs no alt"
          value={report.imagesWithoutAlt}
          severity={report.imagesWithoutAlt > 0 ? 'warn' : undefined}
        />
      </div>

      <div className="stats">
        <Stat label="Words" value={report.wordCount} />
        <Stat label="Int links" value={report.links.internal} />
        <Stat label="Ext links" value={report.links.external} />
      </div>
    </>
  );
}

/** Severity marker text so status is never conveyed by colour alone (WCAG 1.4.1). */
const SEVERITY_MARKER: Record<'warn' | 'poor', string> = {
  warn: 'Warning',
  poor: 'Error',
};

function Stat({
  label,
  value,
  severity,
}: {
  label: string;
  value: number;
  severity?: 'warn' | 'poor';
}) {
  const cls =
    severity === 'poor' ? 'stat stat--poor' : severity === 'warn' ? 'stat stat--warn' : 'stat';
  return (
    <div className={cls}>
      <div className="stat__value mono">{value}</div>
      <div className="stat__label">{label}</div>
      {severity !== undefined && (
        <div className={`stat__severity stat__severity--${severity}`}>
          {SEVERITY_MARKER[severity]}
        </div>
      )}
    </div>
  );
}

function A11ySummary({ report }: { report: A11yReport }) {
  const byImpact = IMPACT_ORDER.map((impact) => ({
    impact,
    count: report.violations.filter((v) => v.impact === impact).length,
  })).filter((row) => row.count > 0);

  return (
    <>
      <div className="stats">
        <Stat
          label="Violations"
          value={report.violations.length}
          severity={report.violations.length > 0 ? 'poor' : undefined}
        />
        <Stat label="Passes" value={report.passes} />
        <Stat label="Incomplete" value={report.incomplete} />
      </div>

      {byImpact.length > 0 && (
        <ul className="impacts" style={{ marginTop: 8 }}>
          {[...byImpact]
            .sort((a, b) => impactRank(a.impact) - impactRank(b.impact))
            .map((row) => (
              <li key={row.impact} className={`impact impact--${row.impact}`}>
                <span className="impact__name">{row.impact}</span>
                <span className="impact__count mono">{row.count}</span>
              </li>
            ))}
        </ul>
      )}
    </>
  );
}

function PresenceRow({ label, present }: { label: string; present: boolean }) {
  return (
    <li className={present ? 'presence__row' : 'presence__row presence__row--missing'}>
      <span className="presence__mark">{present ? '✓' : '✕'}</span>
      <span>{label}</span>
      {!present && <span className="presence__tag">missing</span>}
    </li>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
