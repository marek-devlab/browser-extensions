import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './App';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
