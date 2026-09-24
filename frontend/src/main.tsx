import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { restorePlace } from './lib/reloadAfterAction';

/* Put the page back where the action was performed. Runs before render
   so the first frame is already trying; restorePlace keeps retrying
   until the page is tall enough to scroll, because every screen here
   fetches its data after mount. */
restorePlace();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
