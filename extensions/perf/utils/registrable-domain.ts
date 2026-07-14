// Third-party detection compares registrable domains (PLAN.md §8). A full Public
// Suffix List is too heavy to bundle for this one comparison, so this is a
// pragmatic heuristic: it strips a known set of multi-label public suffixes
// (e.g. co.uk, com.au) before taking the last two labels. It can misjudge exotic
// suffixes; that only ever mislabels the third-party FLAG, never a byte number.

const MULTI_LABEL_SUFFIXES = new Set<string>([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
  'co.nz', 'org.nz', 'govt.nz',
  'co.jp', 'or.jp', 'ne.jp', 'go.jp', 'ac.jp',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'co.in', 'net.in', 'org.in', 'gov.in',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'co.za', 'org.za', 'gov.za',
  'com.mx', 'com.tr', 'com.sg', 'com.hk', 'com.tw',
]);

export function getRegistrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;

  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

/** True when `url`'s registrable domain differs from the page's. */
export function isThirdParty(url: string, pageHostname: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (!host) return false;
  return getRegistrableDomain(host) !== getRegistrableDomain(pageHostname);
}
