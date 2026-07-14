// Mock/stub conventions for the scaffold phase.
//
// The six second-wave extensions ship as UI-complete scaffolds first (surfaces,
// navigation, settings persistence all real), with the domain logic stubbed —
// exactly how the first four started (PLAN.md §15, "Фаза 0 — фундамент"). These
// helpers make every stub obvious, greppable, and honest in the UI, so a mock is
// never mistaken for a working feature (the adblock "48 907" fake-number bug in
// PLAN.md §18a is precisely what this prevents).

/** Grep target for everything still on mocks. */
export const MOCK = true as const;

/**
 * Marks logic that is deliberately not implemented yet. Throw it from a stub so
 * a wired-up-but-empty path fails loudly instead of silently returning garbage.
 * `grep TODO_LOGIC` lists the whole remaining backlog.
 *
 *   async function decodeJwt(): Promise<Claims> {
 *     throw todoLogic('devdata: JWT decode');
 *   }
 */
export function todoLogic(what: string): Error {
  return new Error(`TODO_LOGIC: not implemented — ${what}`);
}

/** Resolve `value` after `ms`, to exercise loading/spinner states against
 *  mock data. Never ship a real feature that depends on this. */
export function mockAsync<T>(value: T, ms = 400): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

/**
 * A visible "this screen is running on mock data" marker. Render it (see
 * @blur/ui <MockBadge>) on any surface whose numbers/content are fabricated, so
 * a reviewer, a teammate, or a screenshot can never mistake the scaffold for a
 * finished product. Remove per surface as its logic lands.
 */
export const MOCK_NOTICE =
  'Демо-данные · логика ещё не подключена (scaffold). / Mock data — logic not wired yet.';
