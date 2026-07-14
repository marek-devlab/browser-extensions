import type { A11yImpact, A11yReport, A11yViolation } from '@blur/core';
import axe from 'axe-core';

// axe-core (MPL-2.0) is BUNDLED, never fetched — MV3 forbids remote code, which
// is exactly why a browser-native, bundleable engine is the right choice. This
// module is the ONLY place that imports axe at runtime, so the heavy library is
// confined to the on-demand `axe-run` inject chunk and never reaches the popup,
// panel or background bundles. Everything here runs in the page: `axe.run` needs
// the live `document`, and mapping in-page keeps axe out of the extension side.

/** axe's `impact` may be null; treat an unranked violation as the least severe. */
function toImpact(impact: axe.ImpactValue): A11yImpact {
  return impact === null ? 'minor' : impact;
}

/**
 * Flatten one axe node target into a single CSS selector string. `target` is an
 * array of frame/shadow selectors; a shadow path is itself an array of hops, so
 * hops are joined with the shadow-piercing marker and frames with a space.
 */
function selectorOf(target: axe.UnlabelledFrameSelector): string {
  return target
    .map((part) => (Array.isArray(part) ? part.join(' >>> ') : part))
    .join(' ');
}

function toViolation(result: axe.Result): A11yViolation {
  return {
    id: result.id,
    impact: toImpact(result.impact ?? null),
    help: result.help,
    helpUrl: result.helpUrl,
    nodes: result.nodes.map((node) => selectorOf(node.target)),
  };
}

export function mapAxeResults(results: axe.AxeResults): A11yReport {
  return {
    violations: results.violations.map(toViolation),
    passes: results.passes.length,
    incomplete: results.incomplete.length,
  };
}

/**
 * Run axe against the whole document and return a mapped report. Invoked ONLY on
 * demand from the audit button — a full axe pass walks the entire tree and is
 * far too expensive to run automatically on every page load.
 */
export async function runA11yAudit(): Promise<A11yReport> {
  const results = await axe.run(document, {
    // Report only rule outcomes the UI shows; skip inapplicable rules to trim
    // the payload marshalled back across the messaging boundary.
    resultTypes: ['violations', 'passes', 'incomplete'],
  });
  return mapAxeResults(results);
}
