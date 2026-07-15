import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { A11yReport } from '@blur/core';
import { LanguageSwitcher, LocaleProvider, type Locale } from '@blur/ui';
import {
  CheckRow,
  ViolationRow,
  useA11yTerm,
  useImpactLabel,
  useImpactMeaning,
} from '../../utils/report-ui';
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
import { ThemeToggle, usePanelPrefs, useSeoLocale } from '../../utils/theme';
import { useT, type MsgKey, type TFn } from '../../utils/i18n';
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

const TABS: { id: TabId; key: MsgKey }[] = [
  { id: 'seo', key: 'tabSeo' },
  { id: 'a11y', key: 'accessibility' },
];

type Async<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; error: string };

export function App() {
  const { locale, setLocale } = useSeoLocale();
  return (
    <LocaleProvider locale={locale}>
      <PanelApp locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

function PanelApp({
  locale,
  setLocale,
}: {
  locale: Locale;
  setLocale: (l: Locale) => void;
}) {
  const t = useT();
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
        <nav className="tabs" role="tablist" aria-label={t('reportSections')}>
          {TABS.map((tabItem, i) => (
            <button
              key={tabItem.id}
              id={`tab-${tabItem.id}`}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              aria-selected={tab === tabItem.id}
              aria-controls={`panel-${tabItem.id}`}
              tabIndex={tab === tabItem.id ? 0 : -1}
              className={tab === tabItem.id ? 'tab tab--active' : 'tab'}
              onClick={() => chooseTab(tabItem.id)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
            >
              {t(tabItem.key)}
            </button>
          ))}
        </nav>
        <ExportControls
          report={seo.status === 'ready' ? seo.value : null}
          a11y={a11y.status === 'ready' ? a11y.value : null}
        />
        <LanguageSwitcher
          locale={locale}
          onChange={setLocale}
          label={t('interfaceLanguage')}
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
  const t = useT();
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
        setCopied(t('copiedReportAs', { fmt: format === 'json' ? 'JSON' : 'Markdown' }));
      } catch {
        setCopied(t('couldNotCopy'));
      }
    },
    [report, a11y, t],
  );

  return (
    <div className="export">
      <button
        className="btn btn--sm"
        onClick={() => void copy('json')}
        disabled={report === null}
        aria-label={t('copyJsonAria')}
      >
        {t('copyJson')}
      </button>
      <button
        className="btn btn--sm"
        onClick={() => void copy('markdown')}
        disabled={report === null}
        aria-label={t('copyMarkdownAria')}
      >
        {t('copyMarkdown')}
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
  const t = useT();
  return (
    <section className="seo">
      <div className="a11y-toolbar">
        <button
          className="btn"
          onClick={() => void onRescan()}
          disabled={state.status === 'loading'}
          aria-label={t('reScanAria')}
        >
          {t('reScanPage')}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {state.status === 'loading' && (
          <p className="state">
            <span className="spinner" /> {t('readingPage')}
          </p>
        )}
        {state.status === 'error' && (
          <p className="state state--error">{state.error}</p>
        )}
        {state.status === 'ready' && (
          <p className="sr-only">{t('seoScanComplete')}</p>
        )}
      </div>
      {state.status === 'ready' && <SeoReportView report={state.value} />}
    </section>
  );
}

function SeoReportView({ report }: { report: SeoReportEx }) {
  const t = useT();
  const skippedLevels = findSkippedHeadingLevels(report.headings);
  const titleStatus = titleLengthStatus(report.title);
  const titleLen = report.title?.length ?? 0;
  const descStatus = descriptionLengthStatus(report.description);
  const descLen = report.description?.length ?? 0;

  return (
    <>
      <h3 className="section-title">{t('metaH')}</h3>
      <dl className="meta">
        <dt>{t('presTitle')}</dt>
        <dd className={report.title === null ? 'meta--missing' : 'mono'}>
          {report.title === null ? (
            t('missing')
          ) : (
            <>
              {report.title}
              <span className={`badge badge--${titleStatus}`}>
                {t('titleBadge', { n: titleLen })}
              </span>
            </>
          )}
        </dd>

        <dt>{t('presDescription')}</dt>
        <dd className={report.description === null ? 'meta--missing' : ''}>
          {/* A null description is a real SEO error, not an empty cell —
              render it as an explicit missing state, never a blank string. */}
          {report.description === null ? (
            t('missing')
          ) : (
            <>
              {report.description}
              <span className={`badge badge--${descStatus}`}>
                {t('descBadge', { n: descLen })}
              </span>
            </>
          )}
        </dd>

        <MetaRow label={t('metaCanonical')} value={report.canonical} />
        <MetaRow label={t('metaRobots')} value={report.robots} />
      </dl>

      <h3 className="section-title">{t('serpPreviewH')}</h3>
      <SerpPreview report={report} />

      {report.hreflang.length > 0 && (
        <>
          <h3 className="section-title">{t('hreflangH')}</h3>
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>{t('thLang')}</th>
                  <th>{t('thHref')}</th>
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
        <h3 className="section-title">{t('headingOutlineH')}</h3>
        <CopyButton text={headingsToMarkdown(report)} label={t('copyHeadings')} />
      </div>
      {report.headings.length === 0 ? (
        <p className="state state--error">{t('noHeadings')}</p>
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
                {skipped && <span className="flag"> {t('skippedLevel')}</span>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="summary-bar">
        <Stat
          label={t('statWords')}
          value={String(report.wordCount)}
          emphasis={report.wordCount < 100}
          hint={report.wordCount < 100 ? t('thinContent') : undefined}
        />
        <Stat label={t('statInternalLinks')} value={String(report.links.internal)} />
        <Stat
          label={t('statExternalLinks')}
          value={String(report.links.external)}
          hint={
            report.links.nofollow +
              report.links.sponsored +
              report.links.ugc >
            0
              ? t('extLinksHint', {
                  nofollow: report.links.nofollow,
                  sponsored: report.links.sponsored,
                  ugc: report.links.ugc,
                })
              : undefined
          }
        />
        <Stat
          label={t('statImagesNoAlt')}
          value={String(report.imagesWithoutAlt)}
          emphasis={report.imagesWithoutAlt > 0}
        />
        <Stat
          label={t('statSdBlocks')}
          value={String(report.structuredDataBlocks)}
          emphasis={report.structuredDataBlocks === 0}
          hint={report.structuredDataBlocks === 0 ? t('noSdHint') : undefined}
        />
      </div>

      <h3 className="section-title">{t('socialPreviewH')}</h3>
      <SocialCard
        social={report.social}
        canonical={report.canonical}
        pageUrl={report.url}
      />

      {report.structuredData.length > 0 && (
        <>
          <h3 className="section-title">{t('sdH')}</h3>
          <ul className="sd-list">
            {report.structuredData.map((item, i) => (
              <StructuredDataRow key={`${item.types.join()}-${i}`} item={item} />
            ))}
          </ul>
        </>
      )}

      <div className="section-head">
        <h3 className="section-title">{t('checksH')}</h3>
        <CopyButton text={checksToMarkdown(report)} label={t('copyChecks')} />
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
  const t = useT();
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
      aria-label={t('copyAriaSuffix', { label })}
    >
      {copied ? t('copiedShort') : label}
    </button>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  const t = useT();
  return (
    <>
      <dt>{label}</dt>
      <dd className={value === null ? 'meta--missing' : 'mono'}>
        {value === null ? t('missing') : value}
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
  const t = useT();
  // The host crawlers show is the page's own (og:url ?? canonical ?? page URL),
  // not the image host — og:image now resolves to an absolute (often CDN) URL.
  const host = hostFrom(social.ogUrl ?? canonical ?? pageUrl, t);
  // Show the image if EITHER og:image or twitter:image is set, but the missing
  // warning below is still keyed to og:image specifically (the crawler default).
  const previewImage = social.ogImage ?? social.twitterImage;
  return (
    <div className="social">
      {previewImage === null ? (
        <div className="social__img social__img--placeholder">
          <span className="social__placeholder-label">{t('noOgImageLabel')}</span>
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
          {social.ogTitle ?? <span className="meta--missing">{t('untitled')}</span>}
        </div>
        <div className="social__desc">
          {social.ogDescription ?? (
            <span className="meta--missing">{t('noDescription')}</span>
          )}
        </div>
        <div className="social__card mono">
          {social.twitterCard ?? t('summaryDefault')}
          {social.ogType !== null && t('ogTypeSuffix', { type: social.ogType })}
        </div>
      </div>
      {social.ogImage === null && (
        <p className="social__warn">
          {social.twitterImage !== null ? (
            <>
              {t('swNo')}
              <code>og:image</code>
              {t('swFb')}
              <code>og:image</code>
              {t('swBlankPreview')}
              <code>twitter:image</code>
              {t('swOnlyTwitter')}
            </>
          ) : (
            <>
              {t('swWithNo')}
              <code>og:image</code>
              {t('swRenderBlank')}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function SerpPreview({ report }: { report: SeoReportEx }) {
  const t = useT();
  const title = serpField(report.title ?? t('serpUntitled'), measureTitle, SERP_TITLE_MAX_PX);
  const desc = serpField(
    report.description ?? t('serpNoDesc'),
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
        <SerpMeter label={t('serpMeterTitle')} field={title} unit="px" />
        <SerpMeter label={t('serpMeterDesc')} field={desc} unit="px" />
      </div>
      {(title.truncated || desc.truncated) && (
        <p className="serp__warn" role="note">
          {title.truncated &&
            t('serpWarnTitle', { px: Math.round(title.pixels), max: SERP_TITLE_MAX_PX })}
          {desc.truncated &&
            t('serpWarnDesc', { px: Math.round(desc.pixels), max: SERP_DESC_MAX_PX })}
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
  const t = useT();
  const complete = item.missingRequired.length === 0;
  return (
    <li className={complete ? 'sd sd--ok' : 'sd sd--warn'}>
      <span className="sd__type mono">{item.types.join(', ') || t('sdUntyped')}</span>
      <span className="sd__status">
        {complete
          ? t('sdRequiredPresent')
          : t('sdMissingList', { list: item.missingRequired.join(', ') })}
      </span>
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
  const t = useT();
  return (
    <section className="a11y">
      <div className="a11y-toolbar">
        <button
          className="btn"
          onClick={() => void onRun()}
          disabled={state.status === 'loading'}
          aria-label={t('runAxeAria')}
        >
          {state.status === 'loading' ? t('running') : t('runAudit')}
        </button>
        <p className="note note--inline">
          {t('axeNote1')}
          <strong>axe-core</strong>
          {t('axeNote2')}
        </p>
      </div>

      <div role="status" aria-live="polite">
        {state.status === 'loading' && (
          <p className="state">
            <span className="spinner" /> {t('auditingPage')}
          </p>
        )}
        {state.status === 'error' && (
          <p className="state state--error">{state.error}</p>
        )}
        {state.status === 'ready' && (
          <p className="sr-only">
            {t(
              state.value.violations.length === 1
                ? 'a11yCompleteOne'
                : 'a11yCompleteOther',
              { n: state.value.violations.length },
            )}
          </p>
        )}
      </div>
      {state.status === 'ready' && <A11yReportView report={state.value} />}
    </section>
  );
}

function A11yReportView({ report }: { report: A11yReport }) {
  const t = useT();
  const a11yTerm = useA11yTerm();
  const impactMeaning = useImpactMeaning();
  const impactLabel = useImpactLabel();
  const sorted = useMemo(
    () =>
      [...report.violations].sort(
        (a, b) => impactRank(a.impact) - impactRank(b.impact),
      ),
    [report],
  );

  return (
    <>
      {/* The counts alone are unreadable to a non-expert ("what IS incomplete?"),
          so each carries its plain-language definition as VISIBLE text. */}
      <div className="summary-bar">
        <Stat
          label={t('tileViolations')}
          value={String(report.violations.length)}
          emphasis={report.violations.length > 0}
          hint={a11yTerm.violations}
        />
        <Stat label={t('tilePasses')} value={String(report.passes)} hint={a11yTerm.passes} />
        <Stat
          label={t('tileIncomplete')}
          value={String(report.incomplete)}
          hint={a11yTerm.incomplete}
        />
      </div>

      <h3 className="section-title">{t('violationsH')}</h3>
      {sorted.length > 0 && (
        <ul className="impact-legend">
          {(['critical', 'serious', 'moderate', 'minor'] as const)
            .filter((i) => sorted.some((v) => v.impact === i))
            .map((impact) => (
              <li key={impact}>
                <span className={`impact-badge impact-badge--${impact}`}>
                  {impactLabel(impact)}
                </span>
                <span className="impact-legend__text">{impactMeaning[impact]}</span>
              </li>
            ))}
        </ul>
      )}
      {sorted.length === 0 ? (
        <p className="state">{t('noViolationsDetected')}</p>
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

function hostFrom(url: string | null, t: TFn): string {
  if (url === null) return t('thisPage');
  try {
    return new URL(url).hostname;
  } catch {
    return t('thisPage');
  }
}
