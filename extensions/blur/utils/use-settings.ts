import { useEffect, useState } from 'react';
import type { BlurExtensionSettings, BlurSettings } from '@blur/core';
import { DEFAULT_BLUR_SETTINGS } from '@blur/core';
import { settingsItem, withSettingsLock } from './storage';

/**
 * A settings patch may carry only the CHANGED `blur` fields (deep-merged onto the
 * freshest stored `blur`), so `blur` is a `Partial<BlurSettings>` here — unlike
 * the full `Partial<BlurExtensionSettings>` whose `blur` would be a whole object.
 */
export type SettingsPatch = Partial<Omit<BlurExtensionSettings, 'blur'>> & {
  blur?: Partial<BlurSettings>;
};

/**
 * Merge a settings patch into a base, DEEP-merging the nested `blur` object (C4).
 * A shallow `{ ...base, ...patch }` would let `patch.blur` replace `base.blur`
 * wholesale, so two same-tick blur edits that each carry only their own changed
 * field would lose one another. Callers therefore pass ONLY the changed `blur`
 * fields (`{ blur: { images: true } }`), and this folds them onto the freshest
 * `blur`. `BlurExtensionSettings` has no other nested object; an adblock-style
 * sub-object would need the same treatment here.
 */
function mergeSettings(
  base: BlurExtensionSettings,
  patch: SettingsPatch,
): BlurExtensionSettings {
  return {
    ...base,
    ...patch,
    blur: patch.blur ? { ...base.blur, ...patch.blur } : base.blur,
  };
}

// Serialize every settings write through one queue (C5). Each write re-reads the
// FRESHEST stored value and merges the patch into it, rather than into a possibly
// stale React snapshot. Within THIS document the queue orders rapid successive
// writes so the second read sees the first. ACROSS documents (background
// toggleSite / commands, popup, options open at once) the read-modify-write is
// additionally wrapped in the process-wide `blur-settings` Web Lock — which the
// background writers also take — so no writer can clobber another's
// allowlist/enabled/blur field. (The background does its own RMW, not this queue,
// but shares the lock.)
let writeQueue: Promise<unknown> = Promise.resolve();

function queueSettingsWrite(patch: SettingsPatch): Promise<void> {
  const run = writeQueue.then(() =>
    withSettingsLock(async () => {
      const current = await settingsItem.getValue();
      await settingsItem.setValue(mergeSettings(current, patch));
    }),
  );
  // Keep the chain alive even if a write rejects, or every later write stalls.
  writeQueue = run.catch(() => {});
  return run;
}

// Reads settings once, keeps them in sync via storage.watch, and persists every
// update. WXT storage is the single source of truth so popup and options stay
// consistent (PLAN.md §13).
export function useSettings(): {
  settings: BlurExtensionSettings;
  update: (patch: SettingsPatch) => void;
  loaded: boolean;
  /** Non-null when the last persist failed, so the UI can stop lying about "saved". */
  error: string | null;
} {
  const [settings, setSettings] = useState<BlurExtensionSettings>(DEFAULT_BLUR_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void settingsItem.getValue().then((value) => {
      if (!active) return;
      setSettings(value);
      setLoaded(true);
    });
    const unwatch = settingsItem.watch((value) => setSettings(value ?? DEFAULT_BLUR_SETTINGS));
    return () => {
      active = false;
      unwatch();
    };
  }, []);

  function update(patch: SettingsPatch): void {
    // Optimistic local echo for a responsive UI; storage.watch reconciles it to
    // the merged stored value. NO setValue inside the state updater (C9): that
    // double-writes under StrictMode and swallows the rejection.
    setSettings((prev) => mergeSettings(prev, patch));
    queueSettingsWrite(patch).then(
      () => setError(null),
      () => setError('Could not save your settings. They may be too large or storage is unavailable.'),
    );
  }

  return { settings, update, loaded, error };
}
