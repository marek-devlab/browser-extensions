import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from '#imports';
import '@blur/ui/tokens.css';
import '@blur/ui/components.css';
import './style.css';
import { App } from './App';

// Match the DevTools theme, not the OS (design §11.3). `prefers-color-scheme`
// follows the OS and would leave a light panel inside dark DevTools;
// `panels.themeName` is the actual DevTools theme. Stamp it on the root so the
// tokens key off it, and re-stamp when the user switches DevTools theme live.
function stampTheme(name: string | undefined): void {
  if (name) document.documentElement.dataset.theme = name === 'dark' ? 'dark' : 'light';
}
const panels = browser.devtools?.panels;
stampTheme(panels?.themeName);
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
