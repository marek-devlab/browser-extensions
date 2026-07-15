import { useCallback, useEffect, useRef, useState } from 'react';
import { applyTheme, cacheTheme, useLocale, type Locale } from '@blur/ui';
import { tAt } from './i18n';
import { DEFAULT_PREFS, prefsItem, type DevdataPrefs } from './storage';

// The localStorage seed key for the anti-FOUC theme stamp. Unique per extension;
// `seedTheme(THEME_CACHE_KEY)` runs in every main.tsx BEFORE createRoot. On a
// full-page tool a light flash is a whole-screen flash.
export const THEME_CACHE_KEY = 'blur-devdata:theme';

// ONE hook, ONE writer for `sync:prefs`.
//
// Theme is folded into this hook (rather than @blur/ui's `useThemeController`)
// on purpose: `sync:prefs` is a single storage item, and two independent writers
// racing read-modify-write on it is the exact hazard the design flags (§8). A
// single writer is the honest fix; `useThemeController` remains right for any
// surface whose theme lives in its own item.
//
// `prefs` is null until the first read resolves. Consumers MUST treat null as
// "not loaded" and disable controls — rendering DEFAULT_PREFS as if it were the
// current value means the first click silently overwrites the real setting
// (design §5.7, §8).

/** Serialise writes so a burst of toggles cannot clobber each other. */
async function withPrefsLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return fn(); // Older engines: the in-flight queue below still applies.
  return locks.request('blur-devdata:prefs', fn);
}

// A tail-chained promise: even without `navigator.locks` (and within one
// document, where locks are cheap but not free), writes leave in order.
let queue: Promise<unknown> = Promise.resolve();

export interface PrefsApi {
  prefs: DevdataPrefs | null;
  update: (patch: Partial<DevdataPrefs>) => void;
  /** True once storage has been read at least once. */
  ready: boolean;
  /** A read/write failure, surfaced rather than swallowed (design §8). */
  error: string | null;
  retry: () => void;
}

export function usePrefs(): PrefsApi {
  const [prefs, setPrefs] = useState<DevdataPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Locale for error copy, via a ref so the stable `update` callback stays stable.
  const localeRef = useRef<Locale>('en');
  localeRef.current = useLocale();

  useEffect(() => {
    let alive = true;
    void prefsItem
      .getValue()
      .then((value) => {
        if (!alive) return;
        setPrefs(value);
        setError(null);
        applyTheme(value.theme);
        cacheTheme(THEME_CACHE_KEY, value.theme);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // Never render defaults as if they were the user's settings — the first
        // click would then persist them over the real ones.
        setError(
          tAt(localeRef.current, 'prefs.readFail', {
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const update = useCallback((patch: Partial<DevdataPrefs>) => {
    setPrefs((prev) => {
      const base: DevdataPrefs = prev ?? DEFAULT_PREFS;
      const next: DevdataPrefs = { ...base, ...patch };
      if (patch.theme !== undefined && patch.theme !== base.theme) {
        applyTheme(next.theme);
        cacheTheme(THEME_CACHE_KEY, next.theme);
      }

      queue = queue
        .then(() =>
          withPrefsLock(async () => {
            // Re-read inside the lock: another surface (popup vs tool page) may
            // have written since we rendered.
            const current = await prefsItem.getValue();
            const merged = { ...current, ...patch };
            // `sync` fails HARD at 8 192 bytes per item. Prefs are ~300 bytes;
            // if this ever trips, it is a bug, and we would rather know than
            // shred the item (PLAN.md §18a).
            if (JSON.stringify(merged).length > 4096) {
              throw new Error(tAt(localeRef.current, 'prefs.tooBig'));
            }
            await prefsItem.setValue(merged);
          }),
        )
        .then(
          () => setError(null),
          (err: unknown) =>
            setError(
              tAt(localeRef.current, 'prefs.saveFail', {
                message: err instanceof Error ? err.message : String(err),
              }),
            ),
        );

      return next;
    });
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { prefs, update, ready: prefs !== null, error, retry };
}
