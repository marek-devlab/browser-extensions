import { useEffect, useState } from 'react';
import { prefsItem, DEFAULT_PREFS, type CapturePrefs } from './storage';

// Reads capturePrefs once, keeps it live via storage.watch, and persists every
// patch (design capture.md §3). WXT storage is the single source of truth so the
// options page and the Studio settings tab (both render <Settings/>) stay
// consistent, even open at once (cf. blur/useSettings, PLAN.md §13).
export function usePrefs(): {
  prefs: CapturePrefs;
  update: (patch: Partial<CapturePrefs>) => void;
  loaded: boolean;
  error: string | null;
} {
  const [prefs, setPrefs] = useState<CapturePrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void prefsItem.getValue().then((value) => {
      if (!active) return;
      setPrefs(value);
      setLoaded(true);
    });
    const unwatch = prefsItem.watch((value) => setPrefs(value ?? DEFAULT_PREFS));
    return () => {
      active = false;
      unwatch();
    };
  }, []);

  function update(patch: Partial<CapturePrefs>): void {
    // Optimistic local echo; storage.watch reconciles to the stored value. The
    // write re-reads the freshest value so a rapid second patch can't clobber the
    // first (the sync-quota / lost-write class of bug — PLAN.md §18a).
    setPrefs((prev) => ({ ...prev, ...patch }));
    void (async () => {
      try {
        const cur = await prefsItem.getValue();
        await prefsItem.setValue({ ...cur, ...patch });
        setError(null);
      } catch {
        setError('save-failed');
      }
    })();
  }

  return { prefs, update, loaded, error };
}
