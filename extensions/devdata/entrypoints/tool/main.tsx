import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@blur/ui/tokens.css';
import '@blur/ui/components.css';
import './style.css';
import { seedTheme } from '@blur/ui';
import { THEME_CACHE_KEY } from '../../utils/prefs';
import { App } from './App';

// The tool page is a FULL browser tab. A white flash here is a whole-screen
// flash, so seeding the theme synchronously before mount matters even more than
// in the popup. The async prefs read (usePrefs) remains the source of truth.
seedTheme(THEME_CACHE_KEY);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
