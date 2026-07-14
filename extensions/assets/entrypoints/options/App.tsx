import type { ReactNode } from 'react';
import { ThemeToggle } from '@blur/ui';
import { usePrefs, useAssetsTheme } from '../../utils/use-prefs';
import type { OverweightThreshold, Units, RequestScope, BufferSize } from '../../utils/storage';

// Options (design §2.8). Every control is a REAL persisted pref (storage.local,
// design §3). 🔴 What is deliberately ABSENT: a save folder, a filename template,
// an "export quality", a "recently inspected" list — each of those would be a claim
// that we store or download something (design §13 №10).

const OVERWEIGHT_OPTIONS: { value: OverweightThreshold; label: string }[] = [
  { value: 1.5, label: '1.5×' },
  { value: 2, label: '2×' },
  { value: 3, label: '3×' },
  { value: 4, label: '4×' },
  { value: 'off', label: 'don’t show' },
];
const BUFFER_OPTIONS: BufferSize[] = [250, 500, 1500, 5000];

export function App() {
  const { prefs, update, loaded } = usePrefs();
  const { theme, setTheme } = useAssetsTheme();

  if (!loaded) return <main className="options"><p>Loading…</p></main>;

  return (
    <main className="options">
      <h1>Asset Inspector — Settings</h1>

      <section>
        <h2>Appearance</h2>
        <Field label="Theme">
          <ThemeToggle theme={theme ?? prefs.theme} onChange={setTheme} />
        </Field>
        <Field label="Size units">
          <Radios<Units>
            name="units"
            value={prefs.units}
            options={[{ value: 1024, label: 'KB/MB (1024)' }, { value: 1000, label: 'kB/MB (1000)' }]}
            onChange={(units) => update({ units })}
          />
        </Field>
      </section>

      <section>
        <h2>Picker</h2>
        <Field label="Shortcut">
          <span className="mono">Alt+Shift+A</span>{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); openShortcuts(); }}>Change in the browser ↗</a>
        </Field>
        <Toggle label="Show ancestor breadcrumbs" checked={prefs.showBreadcrumbs} onChange={(v) => update({ showBreadcrumbs: v })} />
        <Toggle label="Auto-select nearest resource (R automatically)" checked={prefs.autoJumpToResource} onChange={(v) => update({ autoJumpToResource: v })} />
        <Toggle label="Canvas preview" checked={prefs.preview} onChange={(v) => update({ preview: v })}
          hint="The preview is drawn from the already-loaded element. We never request the shown URL again." />
      </section>

      <section>
        <h2>Card</h2>
        <Field label="Overweight threshold">
          <select value={String(prefs.overweightThreshold)} onChange={(e) => update({ overweightThreshold: parseThreshold(e.target.value) })}>
            {OVERWEIGHT_OPTIONS.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
          </select>
        </Field>
        <Toggle label="Expand the srcset table by default" checked={prefs.srcsetExpanded} onChange={(v) => update({ srcsetExpanded: v })} />
        <Field label="Show requests">
          <Radios<RequestScope>
            name="scope"
            value={prefs.requestScope}
            options={[{ value: 'related', label: 'related to the element' }, { value: 'all', label: 'all page requests' }]}
            onChange={(requestScope) => update({ requestScope })}
          />
        </Field>
      </section>

      <section>
        <h2>Hints</h2>
        <Toggle label="“How to get the missing data” hints" checked={prefs.hints} onChange={(v) => update({ hints: v })} />
        <button type="button" className="ghost" onClick={() => update({ hintsDismissed: [] })}>
          Show all hints again
        </button>
      </section>

      <section>
        <h2>Data</h2>
        <Field label="Request buffer size">
          <select value={String(prefs.bufferSize)} onChange={(e) => update({ bufferSize: Number(e.target.value) as BufferSize })}>
            {BUFFER_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <p className="hint">
          ⚠️ Applied on the next page load. Requests the browser already dropped cannot be recovered.
        </p>
      </section>

      <footer>
        The extension stores nothing about the pages you visit and sends no data anywhere.
        The URLs it shows, it does not request.
      </footer>
    </main>
  );
}

function openShortcuts(): void {
  // TODO_LOGIC: chrome.tabs.create('chrome://extensions/shortcuts'). We ship no
  // in-app rebind form on purpose (design §13 №16).
}

function parseThreshold(v: string): OverweightThreshold {
  return v === 'off' ? 'off' : (Number(v) as OverweightThreshold);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="field__control">{children}</div>
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="hint block">{hint}</span>}</span>
    </label>
  );
}

function Radios<T extends string | number>({ name, value, options, onChange }: {
  name: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="radios" role="radiogroup">
      {options.map((o) => (
        <label key={String(o.value)} className="radio">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
