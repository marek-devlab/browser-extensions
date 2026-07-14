import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from '#imports';
import { App } from './App';
import { seedTheme } from '../../utils/theme';
import './style.css';

// Match the DevTools theme, not the OS. `prefers-color-scheme` follows the OS and
// would leave a light panel inside dark DevTools; `panels.themeName` is the actual
// DevTools theme ('dark' | 'default'/'light'). Stamp it on the root so the CSS
// tokens key off it, falling back to prefers-color-scheme when it is unavailable.
const themeName = browser.devtools?.panels?.themeName;
if (themeName) {
  document.documentElement.dataset.theme = themeName === 'dark' ? 'dark' : 'light';
}

// Then override synchronously with the user's saved theme pref (if any), BEFORE
// React mounts, so an explicit Light/Dark choice does not flash the DevTools
// default first. 'auto' resolves back to the DevTools theme stamped above.
seedTheme();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
