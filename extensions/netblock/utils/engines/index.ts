import type { EngineCaps, EngineId, Platform } from '../engine-select';
import { createDebuggerEngine } from './debugger';
import { createDnrEngine } from './dnr';
import { createPageEngine } from './page';
import type { Engine } from './types';
import { createWebRequestEngine } from './webrequest';

export type { Engine, EngineEvent, EngineEventListener } from './types';

/** Which browser APIs exist in this runtime — detected by the background and
 *  passed in, so this module stays free of browser imports. */
export interface EngineApis {
  declarativeNetRequest: boolean;
  scripting: boolean;
  debugger: boolean;
  webRequestBlocking: boolean;
}

/**
 * The engines for a platform, in ladder order. Every engine is constructed
 * (so the UI can always explain "this rule would need X"), and `available`
 * says whether it can actually run here.
 */
export function createEngines(platform: Platform, caps: EngineCaps, apis: EngineApis): Engine[] {
  if (platform === 'firefox') {
    return [createWebRequestEngine(caps, apis.webRequestBlocking)];
  }
  return [
    createDnrEngine(caps, apis.declarativeNetRequest),
    createPageEngine(caps, apis.scripting),
    createDebuggerEngine(caps, apis.debugger),
  ];
}

export function engineById(engines: readonly Engine[], id: EngineId): Engine | undefined {
  return engines.find((e) => e.id === id);
}
