import { useCallback, useEffect, useState } from 'react';
import { applyTheme, cacheTheme } from '@blur/ui';
import { DEFAULT_PREFS, prefsItem, type DevdataPrefs } from './storage';

// The localStorage seed key for the anti-FOUC theme stamp. Must be unique per
// extension; `seedTheme(THEME_CACHE_KEY)` is called in every main.tsx BEFORE
// createRoot. On a full-page tool a light flash is a whole-screen flash, so this
// matters more here than in a popup.
export const THEME_CACHE_KEY = 'blur-devdata:theme';

// One hook, one writer for `sync:prefs`.
//
// Design note (§3, §8): the house convention names @blur/ui's `useThemeController`
// for theme. We instead fold theme INTO this single prefs hook — using
// @blur/ui's `applyTheme` + `cacheTheme` (the exact primitives
// `useThemeController` is built from) — so there is only ONE writer to the
// `sync:prefs` object. Two independent writers (a theme controller + a settings
// hook) racing read-modify-write on the same item is precisely the RMW hazard
// the design flags; keeping a single writer here is the honest fix. Serialising
// writes with `navigator.locks` is still TODO (see below).
//
// `prefs` is `null` until the first async read resolves. Consumers MUST treat
// null as "not loaded yet" and disable controls — rendering DEFAULT_PREFS as if
// it were the current value means the first click overwrites the real setting
// (design §5.7, §8).
export function usePrefs(): {
  prefs: DevdataPrefs | null;
  update: (patch: Partial<DevdataPrefs>) => void;
  /** True once storage has been read at least once. */
  ready: boolean;
} {
  const [prefs, setPrefs] = useState<DevdataPrefs | null>(null);

  useEffect(() => {
    void prefsItem.getValue().then((value) => {
      setPrefs(value);
      applyTheme(value.theme);
      cacheTheme(THEME_CACHE_KEY, value.theme);
    });
  }, []);

  const update = useCallback((patch: Partial<DevdataPrefs>) => {
    setPrefs((prev) => {
      const base: DevdataPrefs = prev ?? DEFAULT_PREFS;
      const next: DevdataPrefs = { ...base, ...patch };
      if (patch.theme !== undefined && patch.theme !== base.theme) {
        applyTheme(next.theme);
        cacheTheme(THEME_CACHE_KEY, next.theme);
      }
      // TODO_LOGIC: devdata — serialise this write behind `navigator.locks`
      // (design §8 "RMW race") so a burst of toggles cannot clobber each other.
      void prefsItem.setValue(next);
      return next;
    });
  }, []);

  return { prefs, update, ready: prefs !== null };
}
