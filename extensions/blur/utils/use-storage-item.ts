import { useEffect, useRef, useState } from 'react';
import type { WxtStorageItem } from '@wxt-dev/storage';
import { withStorageLock } from './storage';

/**
 * Read a WXT storage item, keep it in sync via `watch`, and expose a setter.
 * Generic so the per-site config and image-source rule lists share one hook.
 *
 * `setValue` accepts EITHER a whole value (replace, e.g. an import) OR a
 * React-style updater `(prev) => next`. The updater form is the safe one for a
 * read-modify-write: the persist path re-reads the FRESHEST stored value and
 * applies the updater to THAT, not to a possibly stale React snapshot. Combined
 * with the per-item Web Lock below, a concurrent writer in another context (the
 * background "Always blur images here", a second options window) can no longer
 * clobber an update with a stale value (V6). `T` is always an object here, so the
 * `typeof === 'function'` discriminator never collides with a real value.
 */
export function useStorageItem<
  T,
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  item: WxtStorageItem<T, M>,
): {
  value: T;
  setValue: (next: T | ((prev: T) => T)) => void;
  loaded: boolean;
  /** Non-null when the last persist failed, so the UI can surface it. */
  error: string | null;
} {
  const [value, setValue] = useState<T>(item.fallback);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One write chain per hook instance orders rapid successive writes within THIS
  // document (the second read sees the first); the Web Lock keyed on `item.key`
  // additionally serializes against OTHER contexts writing the same item.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    void item.getValue().then((v) => {
      if (!active) return;
      setValue(v);
      setLoaded(true);
    });
    const unwatch = item.watch((v) => setValue(v));
    return () => {
      active = false;
      unwatch();
    };
  }, [item]);

  function update(next: T | ((prev: T) => T)): void {
    const asUpdater: (prev: T) => T =
      typeof next === 'function' ? (next as (prev: T) => T) : () => next;
    // Optimistic local echo; `watch` reconciles. The write lives OUTSIDE the
    // state setter with its rejection handled (C9), never as a fire-and-forget.
    setValue((prev) => asUpdater(prev));
    const run = queue.current.then(() =>
      withStorageLock(item.key, async () => {
        const current = await item.getValue();
        await item.setValue(asUpdater(current));
      }),
    );
    // Keep the chain alive even if a write rejects, or every later write stalls.
    queue.current = run.catch(() => {});
    run.then(
      () => setError(null),
      () => setError('Could not save. Your storage may be full or unavailable.'),
    );
  }

  return { value, setValue: update, loaded, error };
}
