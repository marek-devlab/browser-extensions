import { MOCK, mockAsync, todoLogic } from '@blur/ui';

// The in-page "Format JSON on this tab" action — STUBBED for the scaffold phase.
//
// The PERMISSION plumbing (utils/permissions.ts) is real. What is stubbed here
// is the ACTION: on Chrome, `scripting.executeScript` reads `document.contentType`
// + `document.body.innerText` on the activeTab-granted tab (design §4.3); on
// Firefox MV2, `tabs.executeScript` from activeTab (no `scripting` needed). The
// injected viewer must keep the ORIGINAL text in a content-script variable so the
// "✕" restores the real document rather than re-deriving it (design §2.12).

export type FormatPageResult =
  | { status: 'formatted' }
  | { status: 'not-json'; contentType: string }
  | { status: 'restricted' }
  | { status: 'denied' };

/** Run the one-shot in-page JSON formatter on `tabId`. Stubbed. */
export async function formatActiveTab(tabId: number): Promise<FormatPageResult> {
  if (!MOCK) {
    // TODO_LOGIC: devdata — inject the reader, branch on document.contentType,
    // render the overlay viewer (§2.12) or return not-json/restricted.
    throw todoLogic('devdata: format JSON on active tab');
  }
  void tabId;
  const r: FormatPageResult = { status: 'formatted' };
  return mockAsync(r, 500);
}

/** Register the opt-in auto-formatter content script on `document_start`. Stubbed. */
export async function registerAutoFormat(): Promise<void> {
  if (!MOCK) {
    // TODO_LOGIC: devdata — `scripting.registerContentScripts` on <all_urls>,
    // document_start, that swaps the view of application/json pages. Must
    // unregister on `permissions.onRemoved` (design §8).
    throw todoLogic('devdata: register auto-format content script');
  }
  return mockAsync(undefined, 200);
}
