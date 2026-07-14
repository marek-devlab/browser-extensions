import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@blur/ui/tokens.css';
import '@blur/ui/components.css';
import './style.css';
import { seedTheme } from '@blur/ui';
import { THEME_CACHE_KEY } from '../../utils/theme';
import { App } from './App';

seedTheme(THEME_CACHE_KEY);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
