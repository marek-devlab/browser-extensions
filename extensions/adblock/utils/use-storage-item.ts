import { useEffect, useRef, useState } from 'react';

/**
 * The subset of a WXT storage item this hook needs. Declared structurally so the
 * hook stays decoupled from WXT's generic `WxtStorageItem` type parameters.
 */
export interface ReactiveItem<T> {
  getValue(): Promise<T>;
  setValue(value: T): Promise<void>;
  watch(cb: (value: T | null) => void): () => void;
}

/**
 * Read a storage item once, keep it live via `watch`, and persist updates. The
 * single source of truth is storage, so every extension surface (popup, options)
 * stays consistent — the same contract `useSettings` uses, generalized.
 */
export function useStorageItem<T>(
  item: ReactiveItem<T>,
  fallback: T,
): { value: T; update: (next: T) => void; loaded: boolean } {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    let active = true;
    void item.getValue().then((v) => {
      if (!active) return;
      setValue(v);
      setLoaded(true);
    });
    const unwatch = item.watch((v) => setValue(v ?? fallbackRef.current));
    return () => {
      active = false;
      unwatch();
    };
    // The item identity is stable across renders (module singleton).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  function update(next: T): void {
    setValue(next);
    void item.setValue(next);
  }

  return { value, update, loaded };
}
