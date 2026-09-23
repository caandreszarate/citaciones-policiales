import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { captureRecoveryFromUrl } from './lib/recovery.ts';
import './styles.css';

// Debe ejecutarse ANTES de montar el router: el retorno de recuperacion puede
// venir como `#access_token=...`, que ocuparia el sitio de `#/ruta`. Aqui se lee,
// se limpia la URL y se deja el hash en la pantalla de nueva contrasena.
captureRecoveryFromUrl();

const root = document.getElementById('root');
if (!root) throw new Error('No se encontro el elemento #root.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
