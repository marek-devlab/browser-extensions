import { defineUnlistedScript } from '#imports';
import { runA11yAudit } from '../utils/a11y';

// On-demand axe-core runner. This is the ONLY module that pulls in axe-core, so
// the ~550 kB library is confined to this one web-accessible chunk and never
// reaches the always-on content script, the popup, or the background.
//
// It is injected into the PAGE (MAIN world) by the content script via WXT's
// `injectScript`, only when an audit is requested — exactly how axe DevTools and
// Lighthouse run axe. axe needs the live `document`, and mapping happens here too
// so the extension side never imports axe. The mapped, serialisable report is
// posted back to the isolated content script through a `window` message tagged
// with the one-time nonce the content script passed on the script's dataset.
export default defineUnlistedScript(() => {
  const el = document.currentScript;
  const nonce = el instanceof HTMLScriptElement ? el.dataset.blurNonce ?? '' : '';

  void runA11yAudit().then(
    (report) => {
      window.postMessage(
        { source: 'blur-seo-a11y', nonce, ok: true, report },
        '*',
      );
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      window.postMessage(
        { source: 'blur-seo-a11y', nonce, ok: false, error: message },
        '*',
      );
    },
  );
});
