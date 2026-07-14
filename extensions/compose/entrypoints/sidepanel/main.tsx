import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@blur/ui/tokens.css';
import '@blur/ui/components.css';
import '../../components/workbench.css';
import './style.css';
import { seedTheme } from '@blur/ui';
import { WorkbenchApp } from '../../components/WorkbenchApp';

// S1 — the PRIMARY surface (design §1.2). Same React app as S2, different shell.
// Seed the theme synchronously from the localStorage mirror BEFORE createRoot so
// an explicit Light/Dark choice never flashes (design §9.3). No DevTools host
// here, so 'auto' defers to prefers-color-scheme.
seedTheme('blur-compose:theme');

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <WorkbenchApp surface="panel" />
  </StrictMode>,
);
