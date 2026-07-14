import { useEffect, useState } from 'react';
import type { WxtStorageItem } from '@wxt-dev/storage';

/**
 * Read a WXT storage item, keep it in sync via `watch`, and expose a setter.
 * Generic so the per-site config and image-source rule lists share one hook.
 */
export function useStorageItem<
  T,
  M extends Record<string, unknown> = Record<string, unknown>,
>(
  item: WxtStorageItem<T, M>,
): {
  value: T;
  setValue: (next: T) => void;
  loaded: boolean;
  /** Non-null when the last persist failed, so the UI can surface it. */
  error: string | null;
} {
  const [value, setValue] = useState<T>(item.fallback);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function update(next: T): void {
    // Optimistic local echo; `watch` reconciles. The write lives OUTSIDE the
    // state setter with its rejection handled (C9), never as a fire-and-forget.
    setValue(next);
    item.setValue(next).then(
      () => setError(null),
      () => setError('Could not save. Your storage may be full or unavailable.'),
    );
  }

  return { value, setValue: update, loaded, error };
}
