import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from '#imports';
import { App } from './App';
import './style.css';

// Match the DevTools theme, not the OS. `prefers-color-scheme` follows the OS and
// would leave a light panel inside dark DevTools; `panels.themeName` is the actual
// DevTools theme ('dark' | 'default'/'light'). Stamp it on the root so the CSS
// tokens key off it, falling back to prefers-color-scheme when it is unavailable.
function stampTheme(name: string | undefined): void {
  if (name) document.documentElement.dataset.theme = name === 'dark' ? 'dark' : 'light';
}

const panels = browser.devtools?.panels;
stampTheme(panels?.themeName);

// The user can switch the DevTools theme while the panel is open; re-stamp on
// change so the panel follows it live instead of only matching at load. The event
// is relatively new (and absent from the polyfill types), so feature-detect before
// subscribing.
const themed = panels as
  | { onThemeChanged?: { addListener(cb: (name: string) => void): void } }
  | undefined;
themed?.onThemeChanged?.addListener((name: string) => stampTheme(name));

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
