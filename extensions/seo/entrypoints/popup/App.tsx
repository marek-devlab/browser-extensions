import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import type { A11yImpact, A11yReport, SeoCheck } from '@blur/core';
import { impactRank, type SeoReportEx } from '../../utils/checks';
import { reportToJson, reportToMarkdown } from '../../utils/export';
import {
  activeTabId,
  requestA11yAudit,
  requestSeoReport,
} from '../../utils/messages';
import {
  A11Y_TERM,
  CheckRow,
  IMPACT_MEANING,
  SEO_TERM,
  ViolationRow,
  useAccordion,
} from '../../utils/report-ui';
import { ThemeToggle, usePanelPrefs } from '../../utils/theme';

// Compact at-a-glance card for the current page. The SEO summary loads on open
// (through the always-on content script — no gesture needed); the accessibility
// audit runs only when the user presses the button, since a full axe pass is too
// costly to run automatically.
//
// Every headline number is a DISCLOSURE, not a dead end. "5 SEO warnings" and
// "5 violations" told the user nothing about WHAT was wrong even though the
// report already carried each check's label+detail and each violation's help
// text, offending selectors and Deque help URL — the popup was simply throwing
// that away. Tapping a tile now reveals exactly what it is made of, reusing the
// panel's CheckRow / ViolationRow (utils/report-ui). Collapsed by default: a user
// who only wants the numbers never pays for the extra height.

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

  // The audited page's own host — NOT the canonical, which can point at another
  // domain and would mislabel the header.
  const host = seo.status === 'ready' ? hostOf(seo.value.url) : 'this page';

  return (
    <div className="popup">
      {/* Two rows: the title and the theme toggle are both fixed-width and fill
          the top row, so the hostname sits on its own row below where it has the
          full popup width to ellipsize into. */}
      <header className="head">
        <div className="head__top">
          <h1>SEO &amp; A11y</h1>
          <ThemeToggle
            theme={prefs?.theme ?? 'auto'}
            onChange={(theme) => update({ theme })}
          />
        </div>
        {/* Ellipsized when long — `title` keeps the full hostname reachable. */}
        <span className="host mono" title={host}>
          {host}
        </span>
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
        Tap any number above to see what it is made of. Open the SEO &amp; A11y
        panel (F12 → "SEO &amp; A11y") for the full report.
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drill-down stat tiles                                              */
/* ------------------------------------------------------------------ */

/** Severity marker text so status is never conveyed by colour alone (WCAG 1.4.1). */
const SEVERITY_MARKER: Record<'warn' | 'poor', string> = {
  warn: 'Warning',
  poor: 'Error',
};

interface Tile {
  id: string;
  label: string;
  value: number;
  severity?: 'warn' | 'poor';
  /** When present, the tile becomes a disclosure button revealing this content. */
  detail?: ReactNode;
}

function tileClass(severity: Tile['severity'], expandable: boolean): string {
  const base = expandable ? 'stat stat--btn' : 'stat';
  if (severity === 'poor') return `${base} stat--poor`;
  if (severity === 'warn') return `${base} stat--warn`;
  return base;
}

/**
 * A row of stat tiles where any tile carrying a `detail` is a real disclosure
 * button (`aria-expanded` + `aria-controls`), keyboard-operable and tap-operable
 * — no hover, since this ships to Firefox for Android. The revealed region is
 * rendered BELOW the row so it gets the popup's full 296px content width instead
 * of a third of it, and only one tile in a row is open at a time so the popup
 * cannot balloon.
 */
function StatRow({ tiles }: { tiles: Tile[] }) {
  const acc = useAccordion();
  const uid = useId();
  const open = tiles.find((t) => acc.isOpen(t.id));

  return (
    <div className="statgroup">
      <div className="stats">
        {tiles.map((t) => {
          const expandable = t.detail !== undefined;
          if (!expandable) {
            return (
              <div key={t.id} className={tileClass(t.severity, false)}>
                <div className="stat__value mono">{t.value}</div>
                <div className="stat__label">{t.label}</div>
              </div>
            );
          }
          const expanded = acc.isOpen(t.id);
          return (
            <button
              key={t.id}
              type="button"
              id={`${uid}-${t.id}-btn`}
              className={tileClass(t.severity, true)}
              aria-expanded={expanded}
              aria-controls={`${uid}-${t.id}-region`}
              onClick={() => acc.toggle(t.id)}
            >
              <span className="stat__value mono">{t.value}</span>
              <span className="stat__label">{t.label}</span>
              {t.severity !== undefined && (
                <span className={`stat__severity stat__severity--${t.severity}`}>
                  {SEVERITY_MARKER[t.severity]}
                </span>
              )}
              <span className="stat__caret" aria-hidden="true">
                {expanded ? '▴' : '▾'}
              </span>
            </button>
          );
        })}
      </div>

      {open !== undefined && (
        <div
          className="drill"
          id={`${uid}-${open.id}-region`}
          role="region"
          aria-labelledby={`${uid}-${open.id}-btn`}
        >
          {open.detail}
        </div>
      )}
    </div>
  );
}

/** The plain-language sentence that opens every drill-down. */
function Gloss({ children }: { children: ReactNode }) {
  return <p className="drill__gloss">{children}</p>;
}

function CheckList({ checks, empty }: { checks: SeoCheck[]; empty: string }) {
  if (checks.length === 0) return <p className="drill__empty">{empty}</p>;
  return (
    <ul className="checks">
      {checks.map((c) => (
        <CheckRow key={c.id} check={c} />
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* SEO                                                                */
/* ------------------------------------------------------------------ */

function SeoSummary({ report }: { report: SeoReportEx }) {
  const errors = report.checks.filter((c) => c.severity === 'error');
  const warnings = report.checks.filter((c) => c.severity === 'warning');
  const altCheck = report.checks.find((c) => c.id === 'img-alt');

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

      <StatRow
        tiles={[
          {
            id: 'seo-errors',
            label: 'SEO errors',
            value: errors.length,
            severity: errors.length > 0 ? 'poor' : undefined,
            detail: (
              <>
                <Gloss>{SEO_TERM.errors}</Gloss>
                <CheckList
                  checks={errors}
                  empty="Nothing failed outright on this page."
                />
              </>
            ),
          },
          {
            id: 'seo-warnings',
            label: 'SEO warnings',
            value: warnings.length,
            severity: warnings.length > 0 ? 'warn' : undefined,
            detail: (
              <>
                <Gloss>{SEO_TERM.warnings}</Gloss>
                <CheckList
                  checks={warnings}
                  empty="No warnings — every check is at best practice."
                />
              </>
            ),
          },
          {
            id: 'imgs-no-alt',
            label: 'Imgs no alt',
            value: report.imagesWithoutAlt,
            severity: report.imagesWithoutAlt > 0 ? 'warn' : undefined,
            detail: (
              <>
                <Gloss>{SEO_TERM.imagesWithoutAlt}</Gloss>
                {altCheck && (
                  <ul className="checks">
                    <CheckRow check={altCheck} />
                  </ul>
                )}
              </>
            ),
          },
        ]}
      />

      <StatRow
        tiles={[
          { id: 'words', label: 'Words', value: report.wordCount },
          { id: 'int-links', label: 'Int links', value: report.links.internal },
          { id: 'ext-links', label: 'Ext links', value: report.links.external },
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Accessibility                                                      */
/* ------------------------------------------------------------------ */

function A11ySummary({ report }: { report: A11yReport }) {
  const sorted = [...report.violations].sort(
    (a, b) => impactRank(a.impact) - impactRank(b.impact),
  );
  const byImpact = IMPACT_ORDER.map((impact) => ({
    impact,
    violations: report.violations.filter((v) => v.impact === impact),
  })).filter((row) => row.violations.length > 0);

  return (
    <>
      <StatRow
        tiles={[
          {
            id: 'violations',
            label: 'Violations',
            value: report.violations.length,
            severity: report.violations.length > 0 ? 'poor' : undefined,
            detail: (
              <>
                <Gloss>{A11Y_TERM.violations}</Gloss>
                {sorted.length === 0 ? (
                  <p className="drill__empty">
                    axe-core found no violations on this page.
                  </p>
                ) : (
                  <ul className="violations">
                    {sorted.map((v) => (
                      <ViolationRow key={v.id} violation={v} />
                    ))}
                  </ul>
                )}
              </>
            ),
          },
          {
            id: 'passes',
            label: 'Passes',
            value: report.passes,
            detail: <Gloss>{A11Y_TERM.passes}</Gloss>,
          },
          {
            id: 'incomplete',
            label: 'Incomplete',
            value: report.incomplete,
            detail: <Gloss>{A11Y_TERM.incomplete}</Gloss>,
          },
        ]}
      />

      {byImpact.length > 0 && <ImpactList rows={byImpact} />}
    </>
  );
}

/**
 * Severity rows. The user guessed these should open the violations at that level
 * — they were right, so they now do, and each carries a one-line definition of
 * what axe means by that impact level.
 */
function ImpactList({
  rows,
}: {
  rows: { impact: A11yImpact; violations: A11yReport['violations'] }[];
}) {
  const acc = useAccordion();
  const uid = useId();

  return (
    <ul className="impacts" style={{ marginTop: 8 }}>
      {[...rows]
        .sort((a, b) => impactRank(a.impact) - impactRank(b.impact))
        .map((row) => {
          const expanded = acc.isOpen(row.impact);
          return (
            <li key={row.impact} className={`sev impact--${row.impact}`}>
              <button
                type="button"
                id={`${uid}-${row.impact}-btn`}
                className="sev__btn"
                aria-expanded={expanded}
                aria-controls={`${uid}-${row.impact}-region`}
                onClick={() => acc.toggle(row.impact)}
              >
                <span className="sev__caret" aria-hidden="true">
                  {expanded ? '▾' : '▸'}
                </span>
                <span className="sev__name">{row.impact}</span>
                <span className="sev__count mono">{row.violations.length}</span>
              </button>
              {expanded && (
                <div
                  className="drill drill--sev"
                  id={`${uid}-${row.impact}-region`}
                  role="region"
                  aria-labelledby={`${uid}-${row.impact}-btn`}
                >
                  <Gloss>{IMPACT_MEANING[row.impact]}</Gloss>
                  <ul className="violations">
                    {row.violations.map((v) => (
                      <ViolationRow key={v.id} violation={v} />
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
    </ul>
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
