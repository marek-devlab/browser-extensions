import { useEffect, useState } from 'react';
import { Spinner } from '@blur/ui';
import { prefsItem } from '../../utils/storage';
import type { ExportPrefs } from '../../utils/types';
import { MOCK_TABLE } from '../../utils/mock-data';
import { PreviewDialog } from '../../utils/preview-dialog';

// The preview surface. In PRODUCTION this dialog is mounted ON THE PAGE by
// engine.js inside a closed shadow root (design §2.3); the extension page here is
// the scaffold's fully-viewable/testable rendering of that same component, and
// the honest fallback route for CSP-blocked pages (design §5.5 renders on our own
// origin). It runs on the MOCK table with your real persisted defaults.

export function App() {
  const [prefs, setPrefs] = useState<ExportPrefs | null>(null);

  useEffect(() => {
    void prefsItem.getValue().then(setPrefs);
  }, []);

  if (!prefs) {
    return (
      <div className="pv-page">
        <Spinner label="Загрузка настроек…" />
      </div>
    );
  }

  return (
    <div className="pv-page">
      <PreviewDialog table={MOCK_TABLE} prefs={prefs} />
    </div>
  );
}
