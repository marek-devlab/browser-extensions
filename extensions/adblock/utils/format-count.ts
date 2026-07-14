/**
 * How the popup renders a blocked/hidden figure, kept pure so it can be unit
 * tested (the JSX `Count` component wraps this).
 *
 * The honesty contract (PLAN.md §5, and the task's assertion 4):
 *   - `null`  → "—"        the platform could not measure it; NEVER a fake 0.
 *   - approximate → "~N"   Chromium's on-demand DNR read; never shown as exact.
 *   - exact   → "N"        cosmetic hides everywhere, and Firefox network blocks.
 *
 * Cosmetic hides are always exact, so they must be rendered with `approximate:
 * false` and never carry the "~".
 */
export function formatCount(value: number | null, approximate: boolean): string {
  if (value === null) return '—';
  return `${approximate ? '~' : ''}${value}`;
}
