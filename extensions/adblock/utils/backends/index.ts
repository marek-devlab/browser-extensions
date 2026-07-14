import { DnrBackend } from './dnr';
import { WebRequestBackend } from './webrequest';
import type { BlockingBackend } from './types';

export type { BlockingBackend, TabCounts } from './types';
export { RULESET_IDS, TRACKING_PARAMS } from './types';

/**
 * Build-time backend selection. `import.meta.env.FIREFOX` is inlined by WXT, so
 * dead-code elimination drops the unused backend from each target bundle and its
 * permissions are never referenced (PLAN.md §4.2).
 */
export function createBackend(): BlockingBackend {
  return import.meta.env.FIREFOX ? new WebRequestBackend() : new DnrBackend();
}
