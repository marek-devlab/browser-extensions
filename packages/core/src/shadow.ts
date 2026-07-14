/**
 * Shadow DOM traversal.
 *
 * A content script's `querySelectorAll` does not pierce shadow roots, and CSS
 * injected into the document does not style anything inside them. Every open
 * root therefore needs its own copy of the stylesheet, and new roots appear at
 * any time. Closed roots are unreachable by design — sites using them cannot be
 * covered, and that is not a bug we can fix.
 *
 * YouTube and most custom-element-based sites use open roots, so this path is
 * load-bearing rather than an edge case.
 */

/** Depth cap: a runaway custom-element tree shouldn't hang the page. */
const MAX_DEPTH = 20;

export function isShadowHost(node: Node): node is Element {
  return node instanceof Element && node.shadowRoot !== null;
}

/** Collect every open shadow root reachable from `root`, breadth-first. */
export function collectOpenShadowRoots(
  root: Document | ShadowRoot | Element,
  depth = 0,
): ShadowRoot[] {
  if (depth >= MAX_DEPTH) return [];

  const found: ShadowRoot[] = [];
  // Use the root's own document: creating a walker from the wrong document
  // (an adopted node, or a same-origin child-frame document) throws
  // WrongDocumentError. A Document has no ownerDocument, so fall back to itself.
  const doc = (root as { ownerDocument?: Document }).ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

  let node: Node | null = walker.currentNode;
  while (node) {
    if (node instanceof Element && node.shadowRoot) {
      found.push(node.shadowRoot);
      found.push(...collectOpenShadowRoots(node.shadowRoot, depth + 1));
    }
    node = walker.nextNode();
  }
  return found;
}

/** `querySelectorAll` that descends into open shadow roots. */
export function deepQuerySelectorAll(
  root: Document | ShadowRoot,
  selector: string,
): Element[] {
  const results: Element[] = [...root.querySelectorAll(selector)];
  for (const shadowRoot of collectOpenShadowRoots(root)) {
    results.push(...shadowRoot.querySelectorAll(selector));
  }
  return results;
}
