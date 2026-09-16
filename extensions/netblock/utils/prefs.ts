import { useCallback, useEffect, useState } from 'react';
import { applyTheme, cacheLocale, cacheTheme } from '@blur/ui';
import { DEFAULT_PREFS, LOCALE_CACHE_KEY, THEME_CACHE_KEY, prefsItem, withLock, type Prefs } from './storage';

// ONE hook, ONE writer for `sync:prefs` (the devdata pattern). Theme and locale
// are folded in here rather than using @blur/ui's two controllers: `sync:prefs`
// is a single storage item, and two independent read-modify-write writers on
// it is exactly the hazard the design flags (§8). Writes go through the
// `netblock-prefs` Web Lock so a burst of toggles cannot clobber each other.
//
// `prefs` is null until the first read resolves. Consumers MUST treat null as
// "not loaded" and disable controls — rendering DEFAULT_PREFS as if it were the
// current value means the first click silently overwrites the real setting.

const PREFS_LOCK = 'netblock-prefs';

export interface PrefsApi {
  prefs: Prefs | null;
  update: (patch: Partial<Prefs>) => void;
  error: string | null;
}

export function usePrefs(): PrefsApi {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void prefsItem
      .getValue()
      .then((value) => {
        if (!alive) return;
        setPrefs(value);
        applyTheme(value.theme);
        cacheTheme(THEME_CACHE_KEY, value.theme);
        cacheLocale(LOCALE_CACHE_KEY, value.locale);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const base = prev ?? DEFAULT_PREFS;
      const next = { ...base, ...patch };
      if (patch.theme !== undefined) {
        applyTheme(patch.theme);
        cacheTheme(THEME_CACHE_KEY, patch.theme);
      }
      if (patch.locale !== undefined) cacheLocale(LOCALE_CACHE_KEY, patch.locale);
      void withLock(PREFS_LOCK, async () => {
        const cur = await prefsItem.getValue();
        await prefsItem.setValue({ ...cur, ...patch });
      }).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
      return next;
    });
  }, []);

  return { prefs, update, error };
}
