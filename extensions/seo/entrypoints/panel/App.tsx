import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  A11yReport,
  A11yViolation,
  SeoCheck,
  SeoSeverity,
} from '@blur/core';
import {
  descriptionLengthStatus,
  findSkippedHeadingLevels,
  impactRank,
  titleLengthStatus,
  type SeoReportEx,
  type SocialPreviewEx,
  type StructuredDataItem,
} from '../../utils/checks';
import {
  checksToMarkdown,
  headingsToMarkdown,
  reportToJson,
  reportToMarkdown,
} from '../../utils/export';
import { requestA11yAudit, requestSeoReport } from '../../utils/messages';
import { ThemeToggle, usePanelPrefs } from '../../utils/theme';
import {
  serpDisplayUrl,
  serpField,
  SERP_DESC_MAX_PX,
  SERP_TITLE_MAX_PX,
  type Measure,
} from '../../utils/serp';

// Pixel measurement for the SERP preview, backed by a single offscreen canvas
// per font (Google renders titles ~20px and descriptions ~14px in Arial).
function makeMeasure(font: string): Measure {
  const ctx = document.createElement('canvas').getContext('2d');
  return (text: string): number => {
    if (ctx === null) return text.length * 8; // Fallback if 2D context is unavailable.
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}
const measureTitle = makeMeasure('20px Arial, sans-serif');
const measureDesc = makeMeasure('14px Arial, sans-serif');

// The panel is a DevTools panel, so the tab under audit is the inspected window.
const tabId = browser.devtools.inspectedWindow.tabId;

type TabId = 'seo' | 'a11y';

const TABS: { id: TabId; label: string }[] = [
  { id: 'seo', label: 'SEO' },
  { id: 'a11y', label: 'Accessibility' },
];

type Async<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; error: string };

export function App() {
  const [tab, setTab] = useState<TabId>('seo');
  const [seo, setSeo] = useState<Async<SeoReportEx>>({ status: 'loading' });
  const [a11y, setA11y] = useState<Async<A11yReport>>({ status: 'idle' });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { prefs, update } = usePanelPrefs();

  // Apply the saved default tab once, when prefs first load — never on later
  // re-renders, so it does not fight the user's manual tab switches.
  const appliedDefaultTab = useRef(false);
  useEffect(() => {
    if (prefs && !appliedDefaultTab.current) {
      appliedDefaultTab.current = true;
      setTab(prefs.defaultTab);
    }
  }, [prefs]);

  // Switch tabs and remember the choice as the persisted default (utils/storage
  // PanelPrefs.defaultTab), so the panel reopens on the section last used.
  const chooseTab = useCallback(
    (id: TabId) => {
      setTab(id);
      update({ defaultTab: id });
    },
    [update],
  );

  function onTabKeyDown(e: React.KeyboardEvent, index: number) {
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    const nextTab = TABS[next];
    if (!nextTab) return;
    chooseTab(nextTab.id);
    tabRefs.current[next]?.focus();
  }

  const scanSeo = useCallback(async () => {
    setSeo({ status: 'loading' });
    const outcome = await requestSeoReport(tabId);
    setSeo(
      outcome.ok
        ? { status: 'ready', value: outcome.data }
        : { status: 'error', error: outcome.error },
    );
  }, []);

  const runAudit = useCallback(async () => {
    setA11y({ status: 'loading' });
    const outcome = await requestA11yAudit(tabId);
    setA11y(
      outcome.ok
        ? { status: 'ready', value: outcome.data }
        : { status: 'error', error: outcome.error },
    );
  }, []);

  // Load the SEO report on open — no user gesture needed, it goes through the
  // already-injected content script.
  useEffect(() => {
    void scanSeo();
  }, [scanSeo]);

  return (
    <div className="panel">
      <div className="panel-head">
        <nav className="tabs" role="tablist" aria-label="Report sections">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={tab === t.id ? 'tab tab--active' : 'tab'}
              onClick={() => chooseTab(t.id)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <ExportControls
          report={seo.status === 'ready' ? seo.value : null}
          a11y={a11y.status === 'ready' ? a11y.value : null}
        />
        <ThemeToggle
          theme={prefs?.theme ?? 'auto'}
          onChange={(theme) => update({ theme })}
        />
      </div>

      <div
        className="tab-body"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'seo' && <SeoTab state={seo} onRescan={scanSeo} />}
        {tab === 'a11y' && <AccessibilityTab state={a11y} onRun={runAudit} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

function ExportControls({
  report,
  a11y,
}: {
  report: SeoReportEx | null;
  a11y: A11yReport | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  // Clear the "Copied…" status after a moment (like the per-section CopyButton),
  // so a stale confirmation does not linger indefinitely.
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (copied === null) return;
    clearTimer.current = setTimeout(() => setCopied(null), 1500);
    return () => {
      if (clearTimer.current !== null) clearTimeout(clearTimer.current);
    };
  }, [copied]);

  const copy = useCallback(
    async (format: 'json' | 'markdown') => {
      if (report === null) return;
      const text =
        format === 'json'
          ? reportToJson(report, a11y)
          : reportToMarkdown(report, a11y);
      try {
        await navigator.clipboard.writeText(text);
        setCopied(`Copied report as ${format === 'json' ? 'JSON' : 'Markdown'}.`);
      } catch {
        setCopied('Could not copy to the clipboard.');
      }
    },
    [report, a11y],
  );

  return (
    <div className="export">
      <button
        className="btn btn--sm"
        onClick={() => void copy('json')}
        disabled={report === null}
        aria-label="Copy report as JSON to the clipboard"
      >
        Copy JSON
      </button>
      <button
        className="btn btn--sm"
        onClick={() => void copy('markdown')}
        disabled={report === null}
        aria-label="Copy report as Markdown to the clipboard"
      >
        Copy Markdown
      </button>
      <span className="export__status" role="status" aria-live="polite">
        {copied}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SEO                                                                */
/* ------------------------------------------------------------------ */

function SeoTab({
  state,
  onRescan,
}: {
  state: Async<SeoReportEx>;
  onRescan: () => Promise<void>;
}) {
  return (
    <section className="seo">
      <div className="a11y-toolbar">
        <button
          className="btn"
          onClick={() => void onRescan()}
          disabled={state.status === 'loading'}
          aria-label="Re-scan the current page for SEO markup"
        >
          Re-scan page
        </button>
      </div>
      <div role="status" aria-live="polite">
        {state.status === 'loading' && (
          <p className="state">
            <span className="spinner" /> Reading the page…
          </p>
        )}
        {state.status === 'error' && (
          <p className="state state--error">{state.error}</p>
        )}
        {state.status === 'ready' && (
          <p className="sr-only">SEO scan complete.</p>
        )}
      </div>
      {state.status === 'ready' && <SeoReportView report={state.value} />}
    </section>
  );
}

function SeoReportView({ report }: { report: SeoReportEx }) {
  const skippedLevels = findSkippedHeadingLevels(report.headings);
  const titleStatus = titleLengthStatus(report.title);
  const titleLen = report.title?.length ?? 0;
  const descStatus = descriptionLengthStatus(report.description);
  const descLen = report.description?.length ?? 0;

  return (
    <>
      <h3 className="section-title">Meta</h3>
      <dl className="meta">
        <dt>Title</dt>
        <dd className={report.title === null ? 'meta--missing' : 'mono'}>
          {report.title === null ? (
            'Missing'
          ) : (
            <>
              {report.title}
              <span className={`badge badge--${titleStatus}`}>
                {titleLen} chars · target 30–60
              </span>
            </>
          )}
        </dd>

        <dt>Description</dt>
        <dd className={report.description === null ? 'meta--missing' : ''}>
          {/* A null description is a real SEO error, not an empty cell —
              render it as an explicit missing state, never a blank string. */}
          {report.description === null ? (
            'Missing'
          ) : (
            <>
              {report.description}
              <span className={`badge badge--${descStatus}`}>
                {descLen} chars · target 120–160
              </span>
            </>
          )}
        </dd>

        <MetaRow label="Canonical" value={report.canonical} />
        <MetaRow label="Robots" value={report.robots} />
      </dl>

      <h3 className="section-title">Google result preview</h3>
      <SerpPreview report={report} />

      {report.hreflang.length > 0 && (
        <>
          <h3 className="section-title">hreflang</h3>
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>lang</th>
                  <th>href</th>
                </tr>
              </thead>
              <tbody>
                {report.hreflang.map((h) => (
                  <tr key={`${h.lang}-${h.href}`}>
                    <td className="mono">{h.lang}</td>
                    <td className="mono url" title={h.href}>
                      {h.href}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="section-head">
        <h3 className="section-title">Heading outline</h3>
        <CopyButton
          text={headingsToMarkdown(report)}
          label="Copy headings"
        />
      </div>
      {report.headings.length === 0 ? (
        <p className="state state--error">No headings found on this page.</p>
      ) : (
        <ul className="outline">
          {report.headings.map((h, i) => {
            const skipped = skippedLevels.has(i);
            return (
              <li
                key={`${h.level}-${i}`}
                className={
                  skipped ? 'outline__item outline__item--skipped' : 'outline__item'
                }
                style={{ paddingLeft: `${(h.level - 1) * 16}px` }}
              >
                <span className="mono outline__level">H{h.level}</span> {h.text}
                {skipped && <span className="flag"> skipped level</span>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="summary-bar">
        <Stat
          label="Words"
          value={String(report.wordCount)}
          emphasis={report.wordCount < 100}
          hint={
            report.wordCount < 100
              ? 'Very little visible text; thin content ranks poorly.'
              : undefined
          }
        />
        <Stat
          label="Internal links"
          value={String(report.links.internal)}
        />
        <Stat
          label="External links"
          value={String(report.links.external)}
          hint={
            report.links.nofollow +
              report.links.sponsored +
              report.links.ugc >
            0
              ? `${report.links.nofollow} nofollow · ${report.links.sponsored} sponsored · ${report.links.ugc} ugc (user-generated content)`
              : undefined
          }
        />
        <Stat
          label="Images without alt"
          value={String(report.imagesWithoutAlt)}
          emphasis={report.imagesWithoutAlt > 0}
        />
        <Stat
          label="Structured data blocks"
          value={String(report.structuredDataBlocks)}
          emphasis={report.structuredDataBlocks === 0}
          hint={
            report.structuredDataBlocks === 0
              ? 'No JSON-LD or microdata found. Rich results are unavailable without it.'
              : undefined
          }
        />
      </div>

      <h3 className="section-title">Social preview</h3>
      <SocialCard
        social={report.social}
        canonical={report.canonical}
        pageUrl={report.url}
      />

      {report.structuredData.length > 0 && (
        <>
          <h3 className="section-title">Structured data</h3>
          <ul className="sd-list">
            {report.structuredData.map((item, i) => (
              <StructuredDataRow key={`${item.types.join()}-${i}`} item={item} />
            ))}
          </ul>
        </>
      )}

      <div className="section-head">
        <h3 className="section-title">Checks</h3>
        <CopyButton text={checksToMarkdown(report)} label="Copy checks" />
      </div>
      <ul className="checks">
        {report.checks.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </ul>
    </>
  );
}

/** A small clipboard button for per-section copy, with a brief "Copied" state. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. denied permission) — leave the label as-is.
    }
  }, [text]);
  return (
    <button
      type="button"
      className="btn btn--sm"
      onClick={() => void onClick()}
      aria-label={`${label} to the clipboard`}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={value === null ? 'meta--missing' : 'mono'}>
        {value === null ? 'Missing' : value}
      </dd>
    </>
  );
}

function SocialCard({
  social,
  canonical,
  pageUrl,
}: {
  social: SocialPreviewEx;
  canonical: string | null;
  pageUrl: string;
}) {
  // The host crawlers show is the page's own (og:url ?? canonical ?? page URL),
  // not the image host — og:image now resolves to an absolute (often CDN) URL.
  const host = hostFrom(social.ogUrl ?? canonical ?? pageUrl);
  // Show the image if EITHER og:image or twitter:image is set, but the missing
  // warning below is still keyed to og:image specifically (the crawler default).
  const previewImage = social.ogImage ?? social.twitterImage;
  return (
    <div className="social">
      {previewImage === null ? (
        <div className="social__img social__img--placeholder">
          <span className="social__placeholder-label">no og:image</span>
        </div>
      ) : (
        <div
          className="social__img"
          // Quote + escape the URL: an og:image containing spaces or parens
          // would otherwise break the unquoted url() and drop the whole preview.
          style={{ backgroundImage: `url("${previewImage.replace(/"/g, '%22')}")` }}
        />
      )}
      <div className="social__body">
        <div className="social__host mono">{host}</div>
        <div className="social__title">
          {social.ogTitle ?? <span className="meta--missing">Untitled</span>}
        </div>
        <div className="social__desc">
          {social.ogDescription ?? (
            <span className="meta--missing">No description</span>
          )}
        </div>
        <div className="social__card mono">
          {social.twitterCard ?? 'summary (default)'}
          {social.ogType !== null && ` · og:type ${social.ogType}`}
        </div>
      </div>
      {social.ogImage === null && (
        <p className="social__warn">
          {social.twitterImage !== null ? (
            <>
              No <code>og:image</code> — Facebook and LinkedIn (which read{' '}
              <code>og:image</code>) will show a blank preview. The image above is
              the <code>twitter:image</code>, which only X/Twitter uses.
            </>
          ) : (
            <>
              With no <code>og:image</code>, this link preview will render blank
              when the page is shared on social platforms.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function SerpPreview({ report }: { report: SeoReportEx }) {
  const title = serpField(report.title ?? 'Untitled page', measureTitle, SERP_TITLE_MAX_PX);
  const desc = serpField(
    report.description ?? 'No meta description — Google will synthesise a snippet.',
    measureDesc,
    SERP_DESC_MAX_PX,
  );

  return (
    <div className="serp">
      <div className="serp__url mono">{serpDisplayUrl(report.url)}</div>
      <div className={report.title === null ? 'serp__title meta--missing' : 'serp__title'}>
        {title.display}
      </div>
      <div className={report.description === null ? 'serp__desc meta--missing' : 'serp__desc'}>
        {desc.display}
      </div>
      <div className="serp__meters">
        <SerpMeter label="Title" field={title} unit="px" />
        <SerpMeter label="Description" field={desc} unit="px" />
      </div>
      {(title.truncated || desc.truncated) && (
        <p className="serp__warn" role="note">
          {title.truncated &&
            `Title is ${Math.round(title.pixels)}px, over the ~${SERP_TITLE_MAX_PX}px Google shows — it will be cut off. `}
          {desc.truncated &&
            `Description is ${Math.round(desc.pixels)}px, over the ~${SERP_DESC_MAX_PX}px shown — the tail is dropped.`}
        </p>
      )}
    </div>
  );
}

function SerpMeter({
  label,
  field,
  unit,
}: {
  label: string;
  field: { pixels: number; maxPixels: number; truncated: boolean };
  unit: string;
}) {
  const pct = Math.min(100, Math.round((field.pixels / field.maxPixels) * 100));
  return (
    <div className="serp-meter">
      <span className="serp-meter__label">{label}</span>
      <span className="serp-meter__track" aria-hidden="true">
        <span
          className={
            field.truncated ? 'serp-meter__fill serp-meter__fill--over' : 'serp-meter__fill'
          }
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="serp-meter__value mono">
        {Math.round(field.pixels)}/{field.maxPixels}
        {unit}
      </span>
    </div>
  );
}

function StructuredDataRow({ item }: { item: StructuredDataItem }) {
  const complete = item.missingRequired.length === 0;
  return (
    <li className={complete ? 'sd sd--ok' : 'sd sd--warn'}>
      <span className="sd__type mono">{item.types.join(', ') || '(untyped)'}</span>
      <span className="sd__status">
        {complete ? (
          'required properties present'
        ) : (
          <>missing: {item.missingRequired.join(', ')}</>
        )}
      </span>
    </li>
  );
}

/** Text label for a severity, so status is never conveyed by colour alone. */
const SEVERITY_LABEL: Record<SeoSeverity, string> = {
  ok: 'Pass',
  warning: 'Warning',
  error: 'Error',
};

function CheckRow({ check }: { check: SeoCheck }) {
  return (
    <li className={`check severity--${check.severity}`}>
      <span className={`check__severity check__severity--${check.severity}`}>
        {SEVERITY_LABEL[check.severity]}
      </span>
      <span className="check__label">{check.label}</span>
      <span className="check__detail">{check.detail}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Accessibility                                                      */
/* ------------------------------------------------------------------ */

function AccessibilityTab({
  state,
  onRun,
}: {
  state: Async<A11yReport>;
  onRun: () => Promise<void>;
}) {
  return (
    <section className="a11y">
      <div className="a11y-toolbar">
        <button
          className="btn"
          onClick={() => void onRun()}
          disabled={state.status === 'loading'}
          aria-label="Run the axe-core accessibility audit on this page"
        >
          {state.status === 'loading' ? 'Running…' : 'Run audit'}
        </button>
        <p className="note note--inline">
          The audit bundles <strong>axe-core</strong> (MPL-2.0), which runs
          entirely in the browser — never fetched at runtime, since MV3 bans
          remote code. It is a separate chunk, injected into the page on demand
          only when you press the button, so it never loads on normal browsing.
        </p>
      </div>

      <div role="status" aria-live="polite">
        {state.status === 'loading' && (
          <p className="state">
            <span className="spinner" /> Auditing the page with axe-core…
          </p>
        )}
        {state.status === 'error' && (
          <p className="state state--error">{state.error}</p>
        )}
        {state.status === 'ready' && (
          <p className="sr-only">
            Accessibility audit complete: {state.value.violations.length} violation
            {state.value.violations.length === 1 ? '' : 's'} found.
          </p>
        )}
      </div>
      {state.status === 'ready' && <A11yReportView report={state.value} />}
    </section>
  );
}

function A11yReportView({ report }: { report: A11yReport }) {
  const sorted = useMemo(
    () =>
      [...report.violations].sort(
        (a, b) => impactRank(a.impact) - impactRank(b.impact),
      ),
    [report],
  );

  return (
    <>
      <div className="summary-bar">
        <Stat
          label="Violations"
          value={String(report.violations.length)}
          emphasis={report.violations.length > 0}
        />
        <Stat label="Passes" value={String(report.passes)} />
        <Stat label="Incomplete" value={String(report.incomplete)} />
      </div>

      <h3 className="section-title">Violations</h3>
      {sorted.length === 0 ? (
        <p className="state">No violations detected by axe-core.</p>
      ) : (
        <ul className="violations">
          {sorted.map((v) => (
            <ViolationRow key={v.id} violation={v} />
          ))}
        </ul>
      )}
    </>
  );
}

function ViolationRow({ violation }: { violation: A11yViolation }) {
  return (
    <li className={`violation impact--${violation.impact}`}>
      <div className="violation__head">
        <span className={`impact-badge impact-badge--${violation.impact}`}>
          {violation.impact}
        </span>
        <span className="violation__help">{violation.help}</span>
      </div>
      <ul className="violation__nodes">
        {violation.nodes.map((n) => (
          <li key={n} className="mono" title={n}>
            {n}
          </li>
        ))}
      </ul>
      <a
        className="violation__link"
        href={violation.helpUrl}
        target="_blank"
        rel="noreferrer"
      >
        {violation.id} — how to fix
      </a>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function Stat({
  label,
  value,
  emphasis,
  hint,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  hint?: string;
}) {
  return (
    <div className={emphasis ? 'stat stat--emphasis' : 'stat'}>
      <div className="stat__value mono">{value}</div>
      <div className="stat__label">{label}</div>
      {/* Guidance is rendered as VISIBLE text (not just a `title` tooltip, which
          keyboard and AT users never see). */}
      {hint !== undefined && <div className="stat__hint">{hint}</div>}
    </div>
  );
}

function hostFrom(url: string | null): string {
  if (url === null) return 'this page';
  try {
    return new URL(url).hostname;
  } catch {
    return 'this page';
  }
}
