// The `chrome.*` APIs referenced inside Playwright `evaluate()` callbacks run in
// the extension page, not Node. Declare a minimal ambient surface so this test
// code type-checks without pulling in @types/chrome (a new dep). Test-only.
declare const chrome: {
  tabs: { query(q: object): Promise<{ id?: number; url?: string }[]> };
  runtime: { sendMessage(msg: unknown): Promise<unknown> };
};
