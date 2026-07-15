import DOMPurify from 'dompurify';

// 🔴 THE SECURITY BOUNDARY (design §7.1, §7.2).
//
// This is the ONLY place in the entire codebase where an HTML STRING is allowed
// to become DOM. Everything that renders the preview goes through
// `sanitizeToFragment`. Keeping it to a single function is what makes the
// sanitizer physically impossible to bypass: there is no other point where a
// string turns into nodes.
//
// 🔴 HARD RULES (enforced by construction — this repo carries no ESLint config;
// see IMPLEMENTATION.md → Security):
//   - NO innerHTML / outerHTML / insertAdjacentHTML / dangerouslySetInnerHTML /
//     eval / new Function anywhere — including "trusted" places.
//   - This function returns a DocumentFragment (RETURN_DOM_FRAGMENT), never a
//     string, and callers attach it with `el.replaceChildren(fragment)`.
//   - The sanitizer is held behind THIS one function so that if the native
//     Element.setHTML() / Sanitizer API reaches Baseline (design §7.2) only this
//     file changes.
//   - `serializeFragment` walks the ALREADY-SANITIZED DOM back to a string for
//     the `text/html` clipboard flavour. That is the DOM→string direction (an
//     escaping serializer), never string→DOM, so it cannot reintroduce a sink.

/** Explicit ALLOW-LIST — allow known-good, not "block known-bad" (design §7.2). */
export const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del',
  's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table',
  'thead', 'tbody', 'tr', 'th', 'td', 'kbd', 'sup', 'sub', 'details', 'summary',
  'span', 'div', 'input',
];

export const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'align', 'colspan', 'rowspan', 'class', 'type',
  'checked', 'disabled', 'open', 'lang', 'dir',
];

/** 🔴 Only http(s)/mailto. `javascript:`/`data:`/`blob:`/`vbscript:` are cut. */
export const ALLOWED_URI_REGEXP = /^(?:https?|mailto):/i;

/** Never allowed, whatever the allow-list says (belt AND braces). */
const FORBID_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta',
  'base', 'svg', 'math', 'template', 'noscript', 'button', 'select', 'textarea',
];

/**
 * ⚠️ `style` as an ATTRIBUTE is 🔴 forbidden (design §7.2): it would let hostile
 * markdown paint a fake UI over the extension's own buttons (clickjacking the
 * "Copy" action). The price is a slightly poorer preview. Correct trade.
 */
const FORBID_ATTR = ['style', 'srcdoc', 'formaction', 'xlink:href', 'action', 'name'];

/** What the sanitizer removed, for the "we stripped something" banner (§7.3). */
export interface SanitizeResult {
  fragment: DocumentFragment;
  /** Human descriptions of removed nodes/attrs, e.g. "<script> (1)". */
  removed: string[];
}

/* ── removal bookkeeping (design §7.3) ─────────────────────────────────────*/

let tally: Map<string, number> | null = null;

function record(what: string): void {
  if (!tally) return;
  tally.set(what, (tally.get(what) ?? 0) + 1);
}

let hooksInstalled = false;

function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  // Count elements the allow-list rejects. `data.allowedTags` is DOMPurify's own
  // lowercased map, so this stays in lockstep with the config actually applied.
  DOMPurify.addHook('uponSanitizeElement', (_node, data) => {
    const tag = data.tagName;
    if (!tag || tag === '#text' || tag === '#comment' || tag === 'body') return;
    if (!data.allowedTags[tag]) record(`<${tag}>`);
  });

  // Count attributes the allow-list rejects (on* handlers, style, srcdoc …) and
  // links whose scheme is not http(s)/mailto.
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    const attr = data.attrName;
    const tag = node.nodeName.toLowerCase();
    if (!attr) return;
    if (!data.allowedAttributes[attr]) {
      record(`атрибут ${attr} у <${tag}>`);
      return;
    }
    if ((attr === 'href' || attr === 'src') && data.attrValue) {
      const value = data.attrValue.trim();
      // Scheme-less (relative / anchor) URLs are left to DOMPurify.
      if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !ALLOWED_URI_REGEXP.test(value)) {
        record(`ссылка с запрещённой схемой в <${tag}>`);
      }
    }
  });

  // Force the safe shape of everything that survived.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();

    if (tag === 'a') {
      // A preview link must never be able to reach back into the panel.
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }

    if (tag === 'img') {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('referrerpolicy', 'no-referrer');
    }

    if (tag === 'input') {
      // ⚠️ GFM task lists are the ONLY reason <input> is on the allow-list.
      // Anything else would be an interactive control inside a privileged page:
      // force it to a DISABLED CHECKBOX, always (design §7.2).
      if (node.getAttribute('type') !== 'checkbox') node.setAttribute('type', 'checkbox');
      node.setAttribute('disabled', '');
      node.removeAttribute('name');
    }
  });
}

/**
 * Turn an (assumed HOSTILE) HTML string into a sanitized DocumentFragment.
 * The single string→DOM point in the codebase.
 */
export function sanitizeToFragment(html: string): SanitizeResult {
  installHooks();
  tally = new Map();
  try {
    const fragment = DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOWED_URI_REGEXP,
      FORBID_TAGS,
      FORBID_ATTR,
      FORBID_CONTENTS: ['script', 'style'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      SAFE_FOR_TEMPLATES: false,
      IN_PLACE: false,
      KEEP_CONTENT: true,
    }) as unknown as DocumentFragment;

    const removed = [...tally.entries()].map(([what, n]) => `${what} (${n})`);
    return { fragment, removed };
  } finally {
    tally = null;
  }
}

/* ── DOM → string (the safe direction) ─────────────────────────────────────*/

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input']);

/** A plain, letter-led HTML attribute name — the only shape serializeFragment
 *  will interpolate raw into markup (see the loop below). */
const ATTR_NAME_RE = /^[a-z][a-z0-9-]*$/i;

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

/**
 * Serialize an ALREADY-SANITIZED fragment back to an HTML string for the
 * `text/html` clipboard flavour (design §6.2). Hand-written rather than
 * `XMLSerializer` so the output is plain HTML (no `xmlns` noise) and so the
 * escaping is ours: every text node and attribute value is entity-escaped, and
 * any tag outside the allow-list is dropped even here.
 */
export function serializeFragment(node: Node): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeText(child.nodeValue ?? '');
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_TAGS.includes(tag)) return;
    let attrs = '';
    for (const a of Array.from(el.attributes)) {
      // Defence-in-depth: values are entity-escaped, but the NAME is interpolated
      // raw into the markup. DOMPurify already dropped anything off ALLOWED_ATTR,
      // yet we do not trust that alone here — skip any name that is not a plain
      // HTML attribute token (letter-led, [a-z0-9-]) so a malformed name can
      // never break out of the attribute position. Legit attributes are unchanged.
      if (!ATTR_NAME_RE.test(a.name)) continue;
      attrs += ` ${a.name}="${escapeAttr(a.value)}"`;
    }
    if (VOID_TAGS.has(tag)) {
      out += `<${tag}${attrs}>`;
      return;
    }
    out += `<${tag}${attrs}>${serializeFragment(el)}</${tag}>`;
  });
  return out;
}
