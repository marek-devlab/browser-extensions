import { Workbench } from './Workbench';
import { usePrefs } from '../utils/use-prefs';

// Thin wrapper shared by the side panel (S1) and the full-page Workbench (S2)
// entrypoints (design §1.2 — one app, two shells; S2 is also the ONLY surface
// Firefox for Android has). Loads prefs, then renders the single <Workbench>.
export function WorkbenchApp({ surface }: { surface: 'panel' | 'workbench' }) {
  const { settings, update, theme, setTheme } = usePrefs();
  if (!settings) return <div className="cw-loading">Загрузка…</div>;
  return (
    <Workbench
      surface={surface}
      settings={settings}
      updateSettings={update}
      theme={theme}
      setTheme={setTheme}
    />
  );
}
