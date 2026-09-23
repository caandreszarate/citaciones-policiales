import { Suspense, lazy } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './features/auth.tsx';
import { config } from './lib/config.ts';
import { AccederPage } from './pages/AccederPage.tsx';
import { RecuperarPage } from './pages/RecuperarPage.tsx';
import { NuevaContrasenaPage } from './pages/NuevaContrasenaPage.tsx';
import { VerificarPage } from './pages/VerificarPage.tsx';

// Las pantallas de administracion arrastran los generadores de PDF y Word. Se
// cargan aparte para que la consulta publica del QR siga siendo ligera.
const GenerarPage = lazy(() =>
  import('./pages/GenerarPage.tsx').then((m) => ({ default: m.GenerarPage })),
);
const HistorialPage = lazy(() =>
  import('./pages/HistorialPage.tsx').then((m) => ({ default: m.HistorialPage })),
);

/**
 * Enrutado por hash (HashRouter).
 *
 * GitHub Pages sirve un sitio estatico bajo una subruta y no sabe reescribir
 * rutas profundas a index.html. Con el hash, /citaciones-policiales/#/verificar/<token>
 * funciona sin configuracion adicional y el QR impreso nunca da 404.
 */
export function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Cabecera />
        <main className="contenedor">
          {!config.isConfigured ? (
            <div className="aviso atencion" role="alert">
              <p>
                <strong>Aplicacion sin configurar.</strong> Faltan <code>VITE_SUPABASE_URL</code> y{' '}
                <code>VITE_SUPABASE_ANON_KEY</code>.
              </p>
              <p>
                Sin esa configuracion no se puede emitir ni consultar. Consulte el README para
                completarla.
              </p>
            </div>
          ) : null}

          <Suspense fallback={<p>Cargando...</p>}>
          <Routes>
            {/* Publica: es la que abre el QR impreso. */}
            <Route path="/verificar/:token" element={<VerificarPage />} />
            <Route path="/acceder" element={<SoloInvitados><AccederPage /></SoloInvitados>} />

            {/* Recuperacion de contrasena. Accesibles sin sesion: quien llega
                desde el correo no la tiene, y quien sigue el enlace SI acaba con
                una sesion de recuperacion, asi que no pueden ir tras SoloInvitados. */}
            <Route path="/recuperar" element={<RecuperarPage />} />
            <Route path="/nueva-contrasena" element={<NuevaContrasenaPage />} />
            <Route path="/" element={<SoloAdministracion><GenerarPage /></SoloAdministracion>} />
            <Route
              path="/historial"
              element={<SoloAdministracion><HistorialPage /></SoloAdministracion>}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </main>
        <footer className="pie">
          <p>
            La consulta del QR confirma la emision del formato y su comisaria. No acredita los
            datos escritos a mano, la firma ni el sello.
          </p>
        </footer>
      </AuthProvider>
    </HashRouter>
  );
}

function Cabecera() {
  const { session, signOut } = useAuth();
  return (
    <header className="cabecera">
      <div className="contenedor">
        <h1>Citaciones policiales</h1>
        {session ? (
          <nav className="navegacion" aria-label="Principal">
            <NavLink to="/">Generar</NavLink>
            <NavLink to="/historial">Historial</NavLink>
            <button type="button" className="secundario" onClick={() => void signOut()}>
              Salir
            </button>
          </nav>
        ) : null}
      </div>
    </header>
  );
}

/**
 * Proteccion de la interfaz. La autorizacion REAL esta en el servidor: estas
 * comprobaciones solo evitan mostrar pantallas que no funcionarian.
 */
function SoloAdministracion({ children }: { children: React.ReactNode }) {
  const { session, isAdmin, loading } = useAuth();
  if (loading) return <p>Cargando...</p>;
  if (!session) return <Navigate to="/acceder" replace />;
  if (!isAdmin) {
    return (
      <div className="aviso atencion" role="alert">
        <p>
          <strong>Cuenta sin autorizar.</strong> Su cuenta existe pero no tiene permiso para emitir
          citaciones.
        </p>
        <p>Solicite a la administracion del sistema que la autorice.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function SoloInvitados({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <p>Cargando...</p>;
  return session ? <Navigate to="/" replace /> : <>{children}</>;
}
