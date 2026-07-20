import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@blur/ui/tokens.css';
import '@blur/ui/components.css';
import './style.css';
import { seedTheme } from '@blur/ui';
import { App } from './App';
import { THEME_SEED_KEY } from '../../utils/settings';

// Stamp the saved theme synchronously BEFORE mounting, so a user who chose Dark on a
// light OS gets no light flash on open. The async prefs read (useSettings) remains
// the source of truth.
seedTheme(THEME_SEED_KEY);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
