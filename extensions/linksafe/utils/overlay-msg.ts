// Shared message contract between the background (injector) and the injected
// overlay content script. Type-only, browser-free, so both sides agree at compile
// time. Every message is triggered by a USER GESTURE (toolbar click / context menu).

export type OverlayMessage =
  | { type: 'linksafe:scan' }
  | { type: 'linksafe:inspect'; url: string }
  | { type: 'linksafe:copy'; text: string };

export interface OverlayAck {
  ok: boolean;
}
