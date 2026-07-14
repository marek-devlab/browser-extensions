import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@blur/ui/tokens.css';
import '@blur/ui/components.css';
import '../../components/workbench.css';
import './style.css';
import { seedTheme } from '@blur/ui';
import { WorkbenchApp } from '../../components/WorkbenchApp';

// S2 — full-page Workbench (design §1.2). Identical app to S1; the extra width
// makes <Workbench> render the split view instead of tabs. Also the "escape
// hatch" if the panel misbehaves on a given build.
seedTheme('blur-compose:theme');

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <WorkbenchApp surface="workbench" />
  </StrictMode>,
);
