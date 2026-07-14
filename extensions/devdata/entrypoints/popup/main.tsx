import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@blur/ui/tokens.css';
import '@blur/ui/components.css';
import './style.css';
import { seedTheme } from '@blur/ui';
import { THEME_CACHE_KEY } from '../../utils/prefs';
import { App } from './App';

// Stamp the saved theme synchronously BEFORE mounting, so a user who chose Dark
// on a light OS does not get a light flash each time the popup opens. The async
// prefs read (in usePrefs) remains the source of truth.
seedTheme(THEME_CACHE_KEY);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
