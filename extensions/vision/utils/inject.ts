// The page-side simulator. This function is serialised and run in the active tab
// by `scripting.executeScript({ func, args })` on the toolbar click (activeTab —
// no host permission, no install warning). It must be SELF-CONTAINED: it may
// reference only globals (document, DOMParser), never module scope.
//
// Idempotent: it removes any prior injection first, then applies the new one; an
// empty `css` means "clear". 🔴 No `innerHTML` — the SVG is parsed with DOMParser
// and imported, so this passes the repo's XSS-sink guard even though it builds
// markup from a string.
export function applyVisionToPage(svg: string, css: string): void {
  const DEF_ID = '__bx_vision_defs';
  const STYLE_ID = '__bx_vision_style';

  document.getElementById(DEF_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();

  // Clear request, or nothing to apply.
  if (!css || !svg) return;

  try {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    // A malformed SVG yields a <parsererror>; bail rather than inject garbage.
    if (parsed.getElementsByTagName('parsererror').length > 0) return;

    const node = document.importNode(parsed.documentElement, true);
    node.setAttribute('id', DEF_ID);
    // Keep the defs carrier out of layout and off the a11y tree.
    const s = (node as unknown as HTMLElement).style;
    if (s) {
      s.position = 'fixed';
      s.width = '0';
      s.height = '0';
      s.pointerEvents = 'none';
    }
    node.setAttribute('aria-hidden', 'true');
    document.documentElement.appendChild(node);

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.documentElement.appendChild(style);
  } catch {
    // Exotic document / CSP / detached frame — fail safe, leave the page untouched.
  }
}
