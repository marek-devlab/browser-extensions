import { defineContentScript, browser } from '#imports';
import {
  PAGE_BRIDGE_TAG,
  PAGE_NONCE_ATTR,
  isPageBridgeMessage,
  isRelayCommand,
  type PageEvent,
  type RelayCommand,
  type RelayMessage,
} from '../utils/protocol';

// ISOLATED-world relay for the page engine (design §7.3; plan
// docs/plans/netblock/02-page.md §2). It is the only party that can talk to
// both sides: the MAIN-world interceptor (same DOM, `window.postMessage`) and
// the background (`runtime.sendMessage`). It carries DATA both ways and
// decides nothing.
//
// ⚠️ `registration: 'runtime'` is load-bearing: this script is NOT in the
// manifest, so the extension asks for NO host permission at install. The page
// engine registers it with `scripting.registerContentScripts` ONLY for the
// origins the user granted from the popup ("Enable on this site"), and
// unregisters on `permissions.onRemoved`. The `<all_urls>` below is what the
// runtime registration is allowed to narrow, and wxt.config.ts strips it from
// the built manifest (guarded by `npm run guards`).
//
// Delivery guarantees (design §8 "SW stopped mid-sequence"): the MAIN side
// already decided synchronously from its mirror; this relay only has to make
// sure the report REACHES the background eventually. Events wait in a queue
// until `sendMessage` resolves, and are retried on the next event or on a
// 2 s timer — so a service worker that was asleep still gets the delta.

const RETRY_MS = 2000;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'ISOLATED',
  allFrames: true,
  // Not in the manifest. Registered at runtime, only with the user's grant.
  registration: 'runtime',

  main() {
    // Mint a per-load nonce and hand it to the MAIN-world script via a root
    // attribute. MAIN echoes it back; posts without it (e.g. forged by another
    // frame) are dropped. Same residual same-page risk as perf's relay: MAIN
    // shares the page's JS context, so the page itself can read the nonce —
    // the worst it can do is pollute its own tab's counters and log rows.
    const nonce = crypto.randomUUID();
    document.documentElement.setAttribute(PAGE_NONCE_ATTR, nonce);

    /* ------------------------ page → background ------------------------ */

    let pending: PageEvent[] = [];
    let inFlight = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function send(message: RelayMessage): Promise<unknown> {
      // Wrapped: after an extension update the context is invalidated and
      // `sendMessage` throws synchronously instead of rejecting.
      try {
        return browser.runtime.sendMessage(message);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    function flush(): void {
      if (inFlight || pending.length === 0) return;
      const batch = pending;
      pending = [];
      inFlight = true;
      // `host` lets the background stamp `initiatorHost` on the log rows
      // without a `tabs` permission (the frame's own hostname, never a path).
      send({ type: 'relay:event', events: batch, host: location.hostname })
        .then(() => {
          inFlight = false;
          if (pending.length) flush();
        })
        .catch(() => {
          // Background asleep or unreachable: keep the batch, retry later.
          inFlight = false;
          pending = batch.concat(pending);
          if (retryTimer === undefined) {
            retryTimer = setTimeout(() => {
              retryTimer = undefined;
              flush();
            }, RETRY_MS);
          }
        });
    }

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data: unknown = event.data;
      if (!isPageBridgeMessage(data) || data.nonce !== nonce) return;
      if (Array.isArray(data.events) && data.events.length) {
        pending.push(...data.events);
        flush();
      }
    });

    /* ------------------------ background → page ------------------------ */

    /* ------------------------- click trigger (DNR) ------------------------- */

    // DNR `window(trigger: 'click')` rules live in the background, not in the
    // page mirror, so the click has to travel there. The listener exists ONLY
    // while `page:rules.wantsClicks` says such a rule is compiled — a site
    // without one pays nothing — and is throttled so a click storm cannot
    // wake the worker 60 times a second (the window is seconds long anyway).
    const CLICK_THROTTLE_MS = 250;
    let clickListening = false;
    let lastClick = 0;
    const onClick = (): void => {
      const now = Date.now();
      if (now - lastClick < CLICK_THROTTLE_MS) return;
      lastClick = now;
      send({ type: 'relay:click' }).catch(() => undefined);
    };
    function setClickListening(on: boolean): void {
      if (on === clickListening) return;
      clickListening = on;
      if (on) document.addEventListener('click', onClick, { capture: true, passive: true });
      else document.removeEventListener('click', onClick, { capture: true });
    }

    function toMain(command: RelayCommand): void {
      if (command.type === 'page:rules') setClickListening(command.wantsClicks === true);
      try {
        // `'/'` targets this document's own origin (valid for opaque origins
        // too, where `location.origin` is "null"); other frames never receive it.
        window.postMessage({ tag: PAGE_BRIDGE_TAG, nonce, command }, '/');
      } catch {
        // Nothing to do: the mirror keeps its last good state.
      }
    }

    browser.runtime.onMessage.addListener((raw: unknown) => {
      if (isRelayCommand(raw)) toMain(raw);
      // No reply; `false` keeps the channel closed synchronously.
      return false;
    });

    /* ------------------------------ ready ------------------------------- */

    // `relay:ready` is answered with `page:rules` (rules + counter mirror) in
    // one round trip. A missing reply means the background threw or was not
    // there yet; try once more after a beat, then leave it to the next apply.
    function announce(attempt: number): void {
      send({ type: 'relay:ready', url: location.href })
        .then((reply) => {
          if (isRelayCommand(reply)) toMain(reply);
          else if (attempt < 2) setTimeout(() => announce(attempt + 1), 1000 * attempt);
        })
        .catch(() => {
          if (attempt < 2) setTimeout(() => announce(attempt + 1), 1000 * attempt);
        });
    }
    announce(1);

    // A bfcache restore reuses this document (no re-injection): re-sync the
    // mirror with whatever the background counted meanwhile, and push any
    // events that were queued when the page was frozen.
    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      announce(1);
      flush();
    });
  },
});
