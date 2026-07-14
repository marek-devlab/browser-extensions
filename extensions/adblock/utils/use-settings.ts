import { useEffect, useState } from 'react';
import type { AdBlockExtensionSettings } from '@blur/core';
import { DEFAULT_ADBLOCK_SETTINGS } from '@blur/core';
import { settingsItem } from './storage';

// Reads settings once, keeps them in sync via storage.watch, and persists every
// update. WXT storage is the single source of truth so popup and options stay
// consistent (PLAN.md §13).
export function useSettings(): {
  settings: AdBlockExtensionSettings;
  update: (patch: Partial<AdBlockExtensionSettings>) => void;
  loaded: boolean;
} {
  const [settings, setSettings] = useState<AdBlockExtensionSettings>(
    DEFAULT_ADBLOCK_SETTINGS,
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void settingsItem.getValue().then((value) => {
      if (!active) return;
      setSettings(value);
      setLoaded(true);
    });
    const unwatch = settingsItem.watch((value) =>
      setSettings(value ?? DEFAULT_ADBLOCK_SETTINGS),
    );
    return () => {
      active = false;
      unwatch();
    };
  }, []);

  function update(patch: Partial<AdBlockExtensionSettings>): void {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void settingsItem.setValue(next);
      return next;
    });
  }

  return { settings, update, loaded };
}
