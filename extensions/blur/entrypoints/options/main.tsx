import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BlurLocaleProvider } from '../../utils/use-locale';
import '../popup/style.css';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <BlurLocaleProvider>
      <App />
    </BlurLocaleProvider>
  </StrictMode>,
);
