import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { seedTheme } from '../../utils/theme';
import './style.css';

// Stamp the saved theme synchronously BEFORE mounting, so a user who chose Dark
// on a light OS does not get a light flash each time the popup opens. The async
// PanelPrefs read (in usePanelPrefs) remains the source of truth.
seedTheme();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
