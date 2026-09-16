import { RESOURCE_KINDS, type ResourceKind } from './rule-types';

// OUR resource names ↔ the three browser vocabularies (design §3 ⚠️ "показываем
// наши имена, маппим внутри"):
//   - Chrome DNR / webRequest `ResourceType`  (developer.chrome.com, 2026-09-11)
//   - Firefox webRequest `ResourceType`       (MDN, 2026-08-21; superset with
//     `beacon`, `imageset`, `json`, `object_subrequest`, `speculative`,
//     `web_manifest`, `xml_dtd`, `xslt`)
//   - CDP `Network.ResourceType`              (browser_protocol.json) for the
//     `debugger` engine's `Fetch.enable` patterns.
// The forward maps are exhaustive over our nine names; the reverse maps fold
// every browser type back into exactly one of ours, so a log row and a rule
// always speak the same language. Pure: no browser imports.

export type DnrResourceType =
  | 'main_frame'
  | 'sub_frame'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'object'
  | 'xmlhttprequest'
  | 'ping'
  | 'csp_report'
  | 'media'
  | 'websocket'
  | 'webbundle'
  | 'webtransport'
  | 'other';

export type FirefoxResourceType =
  | DnrResourceType
  | 'beacon'
  | 'imageset'
  | 'json'
  | 'object_subrequest'
  | 'speculative'
  | 'web_manifest'
  | 'xml_dtd'
  | 'xslt';

export type CdpResourceType =
  | 'Document'
  | 'Stylesheet'
  | 'Image'
  | 'Media'
  | 'Font'
  | 'Script'
  | 'TextTrack'
  | 'XHR'
  | 'Fetch'
  | 'Prefetch'
  | 'EventSource'
  | 'WebSocket'
  | 'Manifest'
  | 'SignedExchange'
  | 'Ping'
  | 'CSPViolationReport'
  | 'Preflight'
  | 'FedCM'
  | 'Other';

const TO_DNR: Record<ResourceKind, DnrResourceType[]> = {
  xhr: ['xmlhttprequest'],
  script: ['script'],
  image: ['image'],
  font: ['font'],
  stylesheet: ['stylesheet'],
  media: ['media'],
  websocket: ['websocket'],
  document: ['main_frame', 'sub_frame'],
  other: ['ping', 'csp_report', 'object', 'webbundle', 'webtransport', 'other'],
};

const TO_FIREFOX: Record<ResourceKind, FirefoxResourceType[]> = {
  // `json` = JSON modules (`import … with { type: 'json' }`), Firefox 138+ — a
  // script-initiated fetch of data, closest to xhr for a resilience test.
  xhr: ['xmlhttprequest', 'json'],
  script: ['script'],
  // `imageset` = <picture>/srcset — an image to the user.
  image: ['image', 'imageset'],
  font: ['font'],
  stylesheet: ['stylesheet', 'xslt'],
  media: ['media'],
  websocket: ['websocket'],
  document: ['main_frame', 'sub_frame'],
  // `beacon` is Firefox's name for sendBeacon; Chrome files it under `ping`.
  other: [
    'ping',
    'beacon',
    'csp_report',
    'object',
    'object_subrequest',
    'web_manifest',
    'xml_dtd',
    'speculative',
    'other',
  ],
};

const TO_CDP: Record<ResourceKind, CdpResourceType[]> = {
  // A fetch() and an XHR are distinct CDP types; `EventSource` and `Preflight`
  // ride along because a page's data traffic includes them.
  xhr: ['XHR', 'Fetch', 'EventSource', 'Preflight'],
  script: ['Script'],
  image: ['Image'],
  font: ['Font'],
  stylesheet: ['Stylesheet'],
  media: ['Media', 'TextTrack'],
  websocket: ['WebSocket'],
  document: ['Document'],
  other: ['Ping', 'CSPViolationReport', 'Manifest', 'Prefetch', 'SignedExchange', 'FedCM', 'Other'],
};

function invert<T extends string>(map: Record<ResourceKind, T[]>): Record<T, ResourceKind> {
  const out = {} as Record<T, ResourceKind>;
  for (const kind of RESOURCE_KINDS) for (const t of map[kind]) out[t] = kind;
  return out;
}

const FROM_DNR = invert(TO_DNR);
const FROM_FIREFOX = invert(TO_FIREFOX);
const FROM_CDP = invert(TO_CDP);

/** DNR `resourceTypes` for a rule's kinds. Empty input → empty (= "all" in DNR). */
export function toDnrTypes(kinds: readonly ResourceKind[]): DnrResourceType[] {
  return uniq(kinds.flatMap((k) => TO_DNR[k]));
}

/** Firefox `filter.types` for a rule's kinds. */
export function toFirefoxTypes(kinds: readonly ResourceKind[]): FirefoxResourceType[] {
  return uniq(kinds.flatMap((k) => TO_FIREFOX[k]));
}

/** CDP `Fetch.enable` `resourceType` values for a rule's kinds. */
export function toCdpTypes(kinds: readonly ResourceKind[]): CdpResourceType[] {
  return uniq(kinds.flatMap((k) => TO_CDP[k]));
}

/** Our name for a Chrome webRequest/DNR type; unknown strings → `other`. */
export function fromDnrType(type: string): ResourceKind {
  return FROM_DNR[type as DnrResourceType] ?? 'other';
}

/** Our name for a Firefox webRequest type; unknown strings → `other`. */
export function fromFirefoxType(type: string): ResourceKind {
  return FROM_FIREFOX[type as FirefoxResourceType] ?? 'other';
}

/** Our name for a CDP `Network.ResourceType`; unknown strings → `other`. */
export function fromCdpType(type: string): ResourceKind {
  return FROM_CDP[type as CdpResourceType] ?? 'other';
}

/** Does a request of browser-reported `type` fall under the rule's `kinds`?
 *  Absent/empty kinds = any type (DNR semantics). */
export function kindMatches(
  kinds: readonly ResourceKind[] | undefined,
  kind: ResourceKind,
): boolean {
  return !kinds || kinds.length === 0 || kinds.includes(kind);
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
