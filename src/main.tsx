import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

/**
 * A number input that has focus changes its value when the wheel passes over it — so
 * picking a stock concentration and then scrolling the page silently edits it by a unit or
 * two. Dropping focus on wheel leaves the number alone and lets the page scroll normally.
 */
document.addEventListener(
  'wheel',
  (e) => {
    const el = document.activeElement;
    if (el !== e.target) return;
    const isNumber = el instanceof HTMLInputElement && el.type === 'number';
    if (isNumber || el instanceof HTMLSelectElement) el.blur();
  },
  { passive: true },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
