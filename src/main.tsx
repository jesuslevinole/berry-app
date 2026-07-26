import React from 'react';
import ReactDOM from 'react-dom/client';
// La marca se importa primero: define los tokens y las clases base (.btn, .input)
// que los CSS de cada componente sobrescriben despues.
import './styles/brand.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
