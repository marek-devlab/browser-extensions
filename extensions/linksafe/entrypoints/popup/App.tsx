import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { Badge, LanguageSwitcher, LocaleProvider, ThemeToggle, type Locale } from '@blur/ui';
import { analyzeLink, riskBadge, type LinkAnalysis } from '../../utils/analyze';
import { resolveDestination, type ResolveOutcome } from '../../utils/resolve';
import {
  addTrustedDomain,
  getTrustedDomains,
  removeTrustedDomain,
  trustedDomainsItem,
} from '../../utils/storage';
import { useLinksafeLocale, useSettings, useThemeSetter } from '../../utils/settings';
import { useT, type MsgKey, type TT } from '../../utils/i18n';

// PRIMARY control surface. 🔴 ZERO network on open — the popup analyses links
// LOCALLY. The one network path (resolve a shortener's destination) is opt-in, gated
// behind the optional host permission requested on the click, and always preceded by
// the plain-language disclosure below (PLAN.md §12.3).

export function App() {
  const { locale, setLocale } = useLinksafeLocale();
  return (
    <LocaleProvider locale={locale}>
      <PopupBody locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

function PopupBody({ locale, setLocale }: { locale: Locale; setLocale: (l: Locale) => void }) {
  const t = useT();
  const { settings, update } = useSettings();
  const { theme, setTheme } = useThemeSetter(settings, update);

  return (
    <div className="popup">
      <header className="head">
        <h1>{t('appTitle')}</h1>
        <ThemeToggle theme={theme} onChange={setTheme} />
      </header>

      <p className="localbadge">🔒 {t('localBadge')}</p>

      <ScanSection t={t} />
      <InspectSection t={t} />
      <TrustedSection t={t} />

      <section className="sect">
        <h2>{t('language')}</h2>
        <LanguageSwitcher locale={locale} onChange={setLocale} label={t('interfaceLanguage')} />
      </section>

      <footer className="foot">{t('aboutLine')}</footer>
    </div>
  );
}

/* --------------------------------- scan ----------------------------------- */

function ScanSection({ t }: { t: TT }) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');

  async function scan() {
    setState('busy');
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (typeof tab?.id !== 'number') {
        setState('error');
        return;
      }
      const ok = (await browser.runtime.sendMessage({ type: 'linksafe:startScan', tabId: tab.id })) as boolean;
      if (ok) {
        // The overlay is now on the page — close the popup so it is visible.
        window.close();
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }

  return (
    <section className="sect">
      <h2>{t('scanTitle')}</h2>
      <button type="button" className="ui-btn ui-btn--primary block" onClick={() => void scan()} disabled={state === 'busy'}>
        {state === 'busy' ? t('loading') : t('scanPage')}
      </button>
      <p className="hint">{t('scanHint')}</p>
      {state === 'error' && (
        <p className="hint hint--error" role="alert">
          {t('cannotScan')}
        </p>
      )}
    </section>
  );
}

/* ------------------------------ manual inspect ---------------------------- */

/** Accept a pasted link with or without a scheme (bit.ly/x → https://bit.ly/x). */
function normalizeInput(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const first = analyzeLink(value);
  if (first.valid) return value;
  const withScheme = analyzeLink('https://' + value);
  return withScheme.valid ? 'https://' + value : null;
}

function InspectSection({ t }: { t: TT }) {
  const [input, setInput] = useState('');
  const [analysis, setAnalysis] = useState<LinkAnalysis | null>(null);
  const [invalid, setInvalid] = useState(false);

  function inspect() {
    const normalized = normalizeInput(input);
    if (!normalized) {
      setInvalid(true);
      setAnalysis(null);
      return;
    }
    setInvalid(false);
    setAnalysis(analyzeLink(normalized));
  }

  return (
    <section className="sect">
      <h2>{t('inspectTitle')}</h2>
      <div className="inputrow">
        <input
          type="text"
          className="ui-input"
          value={input}
          placeholder={t('inspectPlaceholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') inspect();
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="button" className="ui-btn" onClick={inspect}>
          {t('inspectBtn')}
        </button>
      </div>
      {invalid && (
        <p className="hint hint--error" role="alert">
          {t('inspectInvalid')}
        </p>
      )}
      {analysis && <ResultCard t={t} analysis={analysis} />}
    </section>
  );
}

function reasonLines(t: TT, a: LinkAnalysis): { text: string; severity: string }[] {
  return a.signals.map((s) => ({
    text: t(('sig_' + s.code) as MsgKey, s.vars),
    severity: s.severity,
  }));
}

function riskLabel(t: TT, a: LinkAnalysis): string {
  const kind = riskBadge(a.risk);
  return kind === 'poor' ? t('riskPoor') : kind === 'warn' ? t('riskWarn') : t('riskOk');
}

function ResultCard({ t, analysis }: { t: TT; analysis: LinkAnalysis }) {
  const kind = riskBadge(analysis.risk);
  const reasons = reasonLines(t, analysis);
  const host = analysis.displayHost || t('noWebDestination');

  return (
    <div className="card">
      <div className="card__top">
        <Badge severity={kind}>{riskLabel(t, analysis)}</Badge>
        <span className="card__host mono" title={analysis.raw}>
          {host}
        </span>
      </div>

      {analysis.registrableDomain && analysis.registrableDomain !== analysis.displayHost && (
        <p className="card__meta">
          {t('realDomain')}: <span className="mono">{analysis.registrableDomain}</span>
        </p>
      )}
      {analysis.isPunycode && analysis.asciiHost && (
        <p className="card__meta">{t('decodedFrom', { ascii: analysis.asciiHost })}</p>
      )}

      {reasons.length === 0 ? (
        <p className="card__meta">{t('riskOkNote')}</p>
      ) : (
        <ul className="reasons">
          {reasons.map((r, i) => (
            <li key={i} className={`reason reason--${r.severity}`}>
              {r.text}
            </li>
          ))}
        </ul>
      )}

      <CopyRow t={t} analysis={analysis} />
      <ResolveRow t={t} analysis={analysis} />
    </div>
  );
}

function CopyRow({ t, analysis }: { t: TT; analysis: LinkAnalysis }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const hasTracking = analysis.strippedParams.length > 0;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setState('ok');
    } catch {
      setState('fail');
    }
    setTimeout(() => setState('idle'), 1500);
  }

  return (
    <div className="actions">
      <button type="button" className="ui-btn ui-btn--sm" onClick={() => void copy(analysis.raw)}>
        {state === 'ok' ? `✓ ${t('copied')}` : state === 'fail' ? `✕ ${t('copyFailed')}` : t('copyLink')}
      </button>
      {hasTracking && (
        <button
          type="button"
          className="ui-btn ui-btn--sm"
          onClick={() => void copy(analysis.cleanUrl)}
          title={analysis.strippedParams.join(', ')}
        >
          {t('copyClean')}
        </button>
      )}
    </div>
  );
}

/* ------------------------------ network resolve --------------------------- */

type ResolvePhase =
  | { kind: 'idle' }
  | { kind: 'confirm'; trusted: boolean }
  | { kind: 'resolving' }
  | { kind: 'done'; finalUrl: string }
  | { kind: 'error'; message: string };

function ResolveRow({ t, analysis }: { t: TT; analysis: LinkAnalysis }) {
  const [phase, setPhase] = useState<ResolvePhase>({ kind: 'idle' });
  const [always, setAlways] = useState(false);
  const [trustedNow, setTrustedNow] = useState<boolean | null>(null);

  const host = analysis.displayHost || analysis.asciiHost;
  const domain = analysis.registrableDomain;

  // Only http(s) links can be resolved; there is nothing to fetch otherwise.
  const canResolve =
    (analysis.scheme === 'http:' || analysis.scheme === 'https:') && !!analysis.asciiHost;

  useEffect(() => {
    let live = true;
    if (domain) {
      void getTrustedDomains().then((list) => {
        if (live) setTrustedNow(list.includes(domain));
      });
    } else {
      setTrustedNow(false);
    }
    // Reset per-analysis.
    setPhase({ kind: 'idle' });
    setAlways(false);
    return () => {
      live = false;
    };
  }, [analysis.raw, domain]);

  if (!canResolve) return null;

  function outcomeMessage(outcome: Extract<ResolveOutcome, { ok: false }>): string {
    if (outcome.reason === 'permission') return t('resolvePermissionDenied');
    if (outcome.reason === 'unsupported') return t('resolveUnsupported');
    return t('resolveFailed', { error: outcome.error ?? '' });
  }

  async function doResolve() {
    setPhase({ kind: 'resolving' });
    const outcome = await resolveDestination(analysis.raw);
    if (outcome.ok) {
      if (always && domain) await addTrustedDomain(domain);
      setPhase({ kind: 'done', finalUrl: outcome.finalUrl });
    } else {
      setPhase({ kind: 'error', message: outcomeMessage(outcome) });
    }
  }

  if (phase.kind === 'idle') {
    return (
      <button
        type="button"
        className="ui-btn ui-btn--sm resolvebtn"
        onClick={() => {
          // A trusted domain skips the disclosure re-prompt but still goes through
          // permissions.request (silent if already granted).
          if (trustedNow) void doResolve();
          else setPhase({ kind: 'confirm', trusted: false });
        }}
      >
        🌐 {t('resolveBtn')}
      </button>
    );
  }

  if (phase.kind === 'confirm') {
    return (
      <div className="disclose" role="group" aria-label={t('resolveHeading')}>
        <p className="disclose__title">{t('resolveHeading')}</p>
        <p className="disclose__body">{t('resolveDisclosure', { host })}</p>
        {domain && (
          <label className="disclose__always">
            <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
            <span>{t('alwaysResolve', { host: domain })}</span>
          </label>
        )}
        <div className="actions">
          <button type="button" className="ui-btn ui-btn--sm ui-btn--primary" onClick={() => void doResolve()}>
            {t('resolveConfirm', { host })}
          </button>
          <button type="button" className="ui-btn ui-btn--sm" onClick={() => setPhase({ kind: 'idle' })}>
            {t('resolveCancel')}
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'resolving') {
    return (
      <p className="hint" role="status" aria-live="polite">
        <span className="ui-spinner" aria-hidden="true" /> {t('resolving', { host })}
      </p>
    );
  }

  if (phase.kind === 'error') {
    return (
      <p className="hint hint--error" role="alert">
        {phase.message}
      </p>
    );
  }

  // done
  return (
    <div className="resolved">
      <p className="card__meta">{t('resolvedTo')}:</p>
      <p className="resolved__url mono">{phase.finalUrl}</p>
      <p className="hint">{t('resolveNote')}</p>
    </div>
  );
}

/* ------------------------------ trusted list ------------------------------ */

function TrustedSection({ t }: { t: TT }) {
  const [list, setList] = useState<string[]>([]);

  useEffect(() => {
    void getTrustedDomains().then(setList);
    const unwatch = trustedDomainsItem.watch(() => void getTrustedDomains().then(setList));
    return () => unwatch();
  }, []);

  if (list.length === 0) {
    return (
      <section className="sect">
        <h2>{t('trustedTitle')}</h2>
        <p className="hint">{t('trustedEmpty')}</p>
      </section>
    );
  }

  return (
    <section className="sect">
      <h2>{t('trustedTitle')}</h2>
      <p className="hint">{t('trustedHint')}</p>
      <ul className="trusted">
        {list.map((domain) => (
          <li key={domain} className="trusted__row">
            <span className="mono">{domain}</span>
            <button
              type="button"
              className="ui-btn ui-btn--sm"
              aria-label={t('trustedRemove', { host: domain })}
              onClick={() => void removeTrustedDomain(domain).then(setList)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="ui-btn ui-btn--sm"
        onClick={() => void trustedDomainsItem.setValue([]).then(() => setList([]))}
      >
        {t('clearAll')}
      </button>
    </section>
  );
}
