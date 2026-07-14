import { Workbench } from './Workbench';
import { usePrefs } from '../utils/use-prefs';

// Thin wrapper shared by the side panel (S1) and full-page Workbench (S2)
// entrypoints (design §1.2 — one app, two shells). Loads prefs, then renders the
// single <Workbench> with the surface flag.
export function WorkbenchApp({ surface }: { surface: 'panel' | 'workbench' }) {
  const { settings, theme, setTheme } = usePrefs();
  if (!settings) return <div className="cw-loading">Загрузка…</div>;
  return <Workbench surface={surface} settings={settings} theme={theme} setTheme={setTheme} />;
}
