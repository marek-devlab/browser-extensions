import type { AdBlockBackup } from './adblock-types';
import { settingsItem, siteConfigsItem, customFiltersItem } from './storage';

/**
 * Import/export of settings + allowlist + per-site configs + custom filters
 * (feature §4), as a single self-describing JSON document. The pure validation
 * lives in `backup-parse.ts`; this module only touches storage.
 *
 * `parseBackup` is deliberately NOT re-exported from here: WXT auto-imports every
 * exported symbol under `utils/`, and the same name exported from two modules is
 * ambiguous ("Duplicated imports \"parseBackup\" … has been ignored"). Import it
 * from `./backup-parse` — its single source.
 */

export async function exportBackup(): Promise<AdBlockBackup> {
  const [settings, siteConfigs, customFilters] = await Promise.all([
    settingsItem.getValue(),
    siteConfigsItem.getValue(),
    customFiltersItem.getValue(),
  ]);
  return { version: 1, settings, siteConfigs, customFilters };
}

export async function applyBackup(backup: AdBlockBackup): Promise<void> {
  await Promise.all([
    settingsItem.setValue(backup.settings),
    siteConfigsItem.setValue(backup.siteConfigs),
    customFiltersItem.setValue(backup.customFilters),
  ]);
}
