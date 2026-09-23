import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth.tsx';

/** Inicio de sesion. No hay registro publico: las cuentas las crea la administracion. */
export function AccederPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesion.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="centrado">
      <section className="tarjeta">
        <h2>Iniciar sesion</h2>
        <form onSubmit={onSubmit} noValidate>
          <div className="campo">
            <label htmlFor="email">Correo electronico</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={enviando}
            />
          </div>
          <div className="campo">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={enviando}
            />
          </div>

          {error ? (
            <div className="aviso error" role="alert">
              <p>{error}</p>
            </div>
          ) : null}

          <button type="submit" disabled={enviando}>
            {enviando ? 'Comprobando...' : 'Entrar'}
          </button>
        </form>

        <p style={{ marginTop: '1rem', marginBottom: 0 }}>
          <Link to="/recuperar">¿Olvidó su contraseña?</Link>
        </p>
        <p className="ayuda" style={{ marginTop: '0.6rem' }}>
          Las cuentas las crea la administración del sistema. No hay registro público.
        </p>
      </section>
    </div>
  );
}
