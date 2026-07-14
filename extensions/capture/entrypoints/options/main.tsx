import '@blur/ui/tokens.css';
import '@blur/ui/components.css';
import '../editor/style.css';
import './style.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { seedTheme } from '@blur/ui';
import { THEME_SEED_KEY } from '../../utils/storage';
import { App } from './App';

seedTheme(THEME_SEED_KEY);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
