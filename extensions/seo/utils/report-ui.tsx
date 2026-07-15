import { useId, useState } from 'react';
import type {
  A11yImpact,
  A11yViolation,
  SeoCheck,
  SeoSeverity,
} from '@blur/core';
import { useT, type MsgKey } from './i18n';

// Shared report vocabulary + row components, used by BOTH the DevTools panel and
// the popup. The panel already rendered the full detail (a check's label+detail,
// a violation's help/nodes/helpUrl); the popup showed only counts. Rather than
// write that twice, the rows live here and each surface supplies its own CSS for
// the same class names (the popup's copies are tuned for 320px).
//
// The glossary strings are the other half of the job: a bare "INCOMPLETE 2" tells
// a non-expert nothing, and no amount of layout fixes that. Every human-readable
// word here is translated (en/ru/et) through the shared catalog (utils/i18n),
// while the ids/severity tokens that CSS and logic key off stay untranslated.

/** SEO severity → catalog key, so the visible label never conveys status by
 *  colour alone (WCAG 1.4.1) and is spoken in the active language. */
const SEVERITY_LABEL_KEY: Record<SeoSeverity, MsgKey> = {
  ok: 'sevOk',
  warning: 'sevWarning',
  error: 'sevError',
};

/** axe impact → catalog key for its plain-language meaning. */
const IMPACT_MEANING_KEY: Record<A11yImpact, MsgKey> = {
  critical: 'impCritical',
  serious: 'impSerious',
  moderate: 'impModerate',
  minor: 'impMinor',
};

/** axe impact → catalog key for its short display label (the badge text). The
 *  CSS class still keys off the raw `impact` token, so only the label localises. */
const IMPACT_LABEL_KEY: Record<A11yImpact, MsgKey> = {
  critical: 'impactCritical',
  serious: 'impactSerious',
  moderate: 'impactModerate',
  minor: 'impactMinor',
};

const A11Y_TERM_KEY: Record<'violations' | 'passes' | 'incomplete', MsgKey> = {
  violations: 'termViolations',
  passes: 'termPasses',
  incomplete: 'termIncomplete',
};

const SEO_TERM_KEY: Record<'errors' | 'warnings' | 'imagesWithoutAlt', MsgKey> = {
  errors: 'termErrors',
  warnings: 'termWarnings',
  imagesWithoutAlt: 'termImagesWithoutAlt',
};

/** The plain-language meaning of each axe impact level, in the active language. */
export function useImpactMeaning(): Record<A11yImpact, string> {
  const t = useT();
  return {
    critical: t(IMPACT_MEANING_KEY.critical),
    serious: t(IMPACT_MEANING_KEY.serious),
    moderate: t(IMPACT_MEANING_KEY.moderate),
    minor: t(IMPACT_MEANING_KEY.minor),
  };
}

/** The short display label for each axe impact level (badge text). */
export function useImpactLabel(): (impact: A11yImpact) => string {
  const t = useT();
  return (impact) => t(IMPACT_LABEL_KEY[impact]);
}

/** Plain-language gloss for each accessibility headline number. */
export function useA11yTerm(): Record<'violations' | 'passes' | 'incomplete', string> {
  const t = useT();
  return {
    violations: t(A11Y_TERM_KEY.violations),
    passes: t(A11Y_TERM_KEY.passes),
    incomplete: t(A11Y_TERM_KEY.incomplete),
  };
}

/** Gloss for the SEO headline numbers. */
export function useSeoTerm(): Record<'errors' | 'warnings' | 'imagesWithoutAlt', string> {
  const t = useT();
  return {
    errors: t(SEO_TERM_KEY.errors),
    warnings: t(SEO_TERM_KEY.warnings),
    imagesWithoutAlt: t(SEO_TERM_KEY.imagesWithoutAlt),
  };
}

/** How many offending selectors a violation shows before collapsing the rest. */
export const MAX_NODES_SHOWN = 3;

/**
 * The whole `A11yReport` is untrusted: axe runs in the page's MAIN world, so a
 * hostile page can influence (or forge) its output, including `helpUrl`. Only
 * emit an anchor for an `http:`/`https:` URL — a `javascript:`/`data:` URL must
 * never reach an `href`. Anything else falls back to plain text.
 */
function safeHelpUrl(url: string): string | null {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** One SEO check: severity chip, human label, and the detail it already carries.
 *  `check.label`/`check.detail` are already localised at report-build time
 *  (utils/checks.ts, utils/indexability.ts); only the severity chip is resolved
 *  here from the active-locale catalog. */
export function CheckRow({ check }: { check: SeoCheck }) {
  const t = useT();
  return (
    <li className={`check severity--${check.severity}`}>
      <span className={`check__severity check__severity--${check.severity}`}>
        {t(SEVERITY_LABEL_KEY[check.severity])}
      </span>
      <span className="check__label">{check.label}</span>
      <span className="check__detail">{check.detail}</span>
    </li>
  );
}

/**
 * One a11y violation: impact badge, axe's plain-language `help` (axe's own text,
 * left untranslated), HOW MANY elements are affected, the offending selectors
 * (truncated past `MAX_NODES_SHOWN` so one bad rule cannot flood a 320px popup),
 * and a link to Deque's full explanation.
 */
export function ViolationRow({ violation }: { violation: A11yViolation }) {
  const t = useT();
  const impactLabel = useImpactLabel();
  const shown = violation.nodes.slice(0, MAX_NODES_SHOWN);
  const hidden = violation.nodes.length - shown.length;
  const count = violation.nodes.length;
  const helpHref = safeHelpUrl(violation.helpUrl);

  return (
    <li className={`violation impact--${violation.impact}`}>
      <div className="violation__head">
        <span className={`impact-badge impact-badge--${violation.impact}`}>
          {impactLabel(violation.impact)}
        </span>
        <span className="violation__help">{violation.help}</span>
      </div>
      <p className="violation__count">
        {t(count === 1 ? 'violElementsOne' : 'violElementsOther', { count })}
      </p>
      <ul className="violation__nodes">
        {shown.map((n) => (
          <li key={n} className="mono" title={n}>
            {n}
          </li>
        ))}
        {hidden > 0 && (
          <li className="violation__more">
            {t(hidden === 1 ? 'violMoreOne' : 'violMoreOther', { n: hidden })}
          </li>
        )}
      </ul>
      {helpHref !== null ? (
        <a
          className="violation__link"
          href={helpHref}
          target="_blank"
          rel="noreferrer"
        >
          {t('howToFix', { id: violation.id })}
        </a>
      ) : (
        <span className="violation__link">{t('howToFix', { id: violation.id })}</span>
      )}
    </li>
  );
}

/**
 * A tap-and-keyboard disclosure. A real <button> with `aria-expanded` pointing at
 * the region it controls — NOT a hover affordance, because this ships to Firefox
 * for Android where there is no hover, and not a <details> because the trigger is
 * a stat tile that must stay a flex child of the tile row while the region it
 * opens renders full-width BELOW that row.
 */
export function useDisclosureId(prefix: string): { buttonId: string; regionId: string } {
  const id = useId();
  return { buttonId: `${prefix}-btn-${id}`, regionId: `${prefix}-region-${id}` };
}

/** Single-open accordion state: opening a section closes the previous one. */
export function useAccordion(): {
  openId: string | null;
  toggle: (id: string) => void;
  isOpen: (id: string) => boolean;
} {
  const [openId, setOpenId] = useState<string | null>(null);
  return {
    openId,
    toggle: (id: string) => setOpenId((prev) => (prev === id ? null : id)),
    isOpen: (id: string) => openId === id,
  };
}
