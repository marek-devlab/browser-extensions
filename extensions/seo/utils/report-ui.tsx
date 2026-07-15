import { useId, useState } from 'react';
import type {
  A11yImpact,
  A11yViolation,
  SeoCheck,
  SeoSeverity,
} from '@blur/core';

// Shared report vocabulary + row components, used by BOTH the DevTools panel and
// the popup. The panel already rendered the full detail (a check's label+detail,
// a violation's help/nodes/helpUrl); the popup showed only counts. Rather than
// write that twice, the rows live here and each surface supplies its own CSS for
// the same class names (the popup's copies are tuned for 320px).
//
// The glossary strings are the other half of the job: a bare "INCOMPLETE 2" tells
// a non-expert nothing, and no amount of layout fixes that. The words below are
// the answer to "как пользователю понять?" and are rendered next to the numbers.

/** Text label for an SEO severity, so status is never conveyed by colour alone. */
export const SEVERITY_LABEL: Record<SeoSeverity, string> = {
  ok: 'Pass',
  warning: 'Warning',
  error: 'Error',
};

/**
 * What each axe-core impact level actually means, in plain language. axe assigns
 * exactly one of these to every violation; the words are ours, the levels are
 * axe's (https://github.com/dequelabs/axe-core/blob/develop/doc/API.md).
 */
export const IMPACT_MEANING: Record<A11yImpact, string> = {
  critical:
    'Blocks people with disabilities from using this content at all. Fix first.',
  serious:
    'A severe barrier: many people will be blocked or badly slowed down.',
  moderate:
    'Frustrating, but most people can still work around it.',
  minor:
    'A small annoyance affecting few people. Fix once the rest is done.',
};

/** Plain-language gloss for each accessibility headline number. */
export const A11Y_TERM: Record<'violations' | 'passes' | 'incomplete', string> = {
  violations:
    'Accessibility rules this page BROKE. Each one names what is wrong and which elements are at fault.',
  passes:
    'Rules that ran and found nothing wrong. This counts RULES, not elements — a high number is normal and is not a score.',
  incomplete:
    'axe-core could not decide automatically and needs a human to look. Typically text over an image or a video, where contrast cannot be computed. Not necessarily a problem — just unproven.',
};

/** Gloss for the SEO headline numbers. */
export const SEO_TERM: Record<'errors' | 'warnings' | 'imagesWithoutAlt', string> = {
  errors:
    'Checks that failed outright — these actively cost you search visibility.',
  warnings:
    'Checks that passed but are below best practice. Worth fixing, not urgent.',
  imagesWithoutAlt:
    'Images with no alt attribute. Screen readers announce nothing for them, and search engines cannot read them. alt="" is fine for purely decorative images.',
};

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

/** One SEO check: severity chip, human label, and the detail it already carries. */
export function CheckRow({ check }: { check: SeoCheck }) {
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

/**
 * One a11y violation: impact badge, axe's plain-language `help`, HOW MANY
 * elements are affected, the offending selectors (truncated past
 * `MAX_NODES_SHOWN` so one bad rule cannot flood a 320px popup), and a link to
 * Deque's full explanation.
 */
export function ViolationRow({ violation }: { violation: A11yViolation }) {
  const shown = violation.nodes.slice(0, MAX_NODES_SHOWN);
  const hidden = violation.nodes.length - shown.length;
  const count = violation.nodes.length;
  const helpHref = safeHelpUrl(violation.helpUrl);

  return (
    <li className={`violation impact--${violation.impact}`}>
      <div className="violation__head">
        <span className={`impact-badge impact-badge--${violation.impact}`}>
          {violation.impact}
        </span>
        <span className="violation__help">{violation.help}</span>
      </div>
      <p className="violation__count">
        {count} element{count === 1 ? '' : 's'} affected
      </p>
      <ul className="violation__nodes">
        {shown.map((n) => (
          <li key={n} className="mono" title={n}>
            {n}
          </li>
        ))}
        {hidden > 0 && (
          <li className="violation__more">
            + {hidden} more element{hidden === 1 ? '' : 's'}
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
          {violation.id} — how to fix
        </a>
      ) : (
        <span className="violation__link">{violation.id} — how to fix</span>
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
