import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.ts';
import { checkPassword, PASSWORD_RULES } from '../domain/password.ts';
import {
  describeRecoveryError,
  takeRecoveryEntry,
  type RecoveryEntry,
  type RecoveryPurpose,
} from '../lib/recovery.ts';

/**
 * Establecer una contrasena nueva tras seguir el enlace del correo.
 *
 * Los parametros del enlace los captura main.tsx antes de montar el router, para
 * que no choquen con el enrutado por hash y no queden en la barra de direcciones.
 */

type Estado =
  | { fase: 'preparando' }
  | { fase: 'listo' }
  | { fase: 'enlace-invalido'; motivo: string }
  | { fase: 'guardando' }
  | { fase: 'hecho' };

/** Mismo flujo para recuperar y para estrenar cuenta; cambia como se explica. */
const TEXTOS: Record<RecoveryPurpose, { titulo: string; entrada: string; exito: string }> = {
  recovery: {
    titulo: 'Nueva contraseña',
    entrada: 'Elija una contraseña nueva para su cuenta.',
    exito: 'Contraseña actualizada. Ya puede usarla para entrar.',
  },
  invite: {
    titulo: 'Establecer su contraseña',
    entrada:
      'Le han dado de alta en el sistema. Elija la contraseña con la que entrará a partir de ahora.',
    exito: 'Contraseña establecida. Su cuenta ya está lista.',
  },
  desconocido: {
    titulo: 'Nueva contraseña',
    entrada: 'Elija la contraseña con la que entrará al sistema.',
    exito: 'Contraseña guardada. Ya puede usarla para entrar.',
  },
};

export function NuevaContrasenaPage() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<Estado>({ fase: 'preparando' });
  const [proposito, setProposito] = useState<RecoveryPurpose>('desconocido');
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Se canjea el enlace por una sesion. Solo se ejecuta una vez: takeRecoveryEntry
  // consume la entrada para que un re-render no vuelva a intentarlo.
  useEffect(() => {
    let activo = true;

    async function preparar(): Promise<Estado> {
      if (!supabase) {
        return { fase: 'enlace-invalido', motivo: 'La aplicación no está configurada.' };
      }

      const entrada: RecoveryEntry | null = takeRecoveryEntry();

      if (entrada?.kind === 'error') {
        return {
          fase: 'enlace-invalido',
          motivo: describeRecoveryError(entrada.code, entrada.description),
        };
      }

      if (entrada) setProposito(entrada.purpose);

      if (entrada?.kind === 'tokens') {
        const { error: fallo } = await supabase.auth.setSession({
          access_token: entrada.accessToken,
          refresh_token: entrada.refreshToken,
        });
        if (fallo) {
          return { fase: 'enlace-invalido', motivo: describeRecoveryError('', fallo.message) };
        }
        return { fase: 'listo' };
      }

      if (entrada?.kind === 'code') {
        const { error: fallo } = await supabase.auth.exchangeCodeForSession(entrada.code);
        if (fallo) {
          return { fase: 'enlace-invalido', motivo: describeRecoveryError('', fallo.message) };
        }
        return { fase: 'listo' };
      }

      // Sin datos en el enlace: puede que ya hubiera sesion (por ejemplo, si se
      // recarga la pagina despues de canjearlo). Si no la hay, el enlace no sirve.
      const { data } = await supabase.auth.getSession();
      if (data.session) return { fase: 'listo' };

      return {
        fase: 'enlace-invalido',
        motivo:
          'No se ha recibido ningún enlace válido. Puede que haya caducado, que ya se utilizara o que la dirección esté incompleta.',
      };
    }

    void preparar().then((siguiente) => {
      if (activo) setEstado(siguiente);
    });

    return () => {
      activo = false;
    };
  }, []);

  const comprobacion = checkPassword(password);
  const coinciden = password !== '' && password === repetida;
  const puedeEnviar = comprobacion.ok && coinciden && estado.fase === 'listo';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!puedeEnviar || !supabase) return;

    setEstado({ fase: 'guardando' });
    setError(null);
    try {
      const { error: fallo } = await supabase.auth.updateUser({ password });
      if (fallo) throw new Error(fallo.message);
      setPassword('');
      setRepetida('');
      setEstado({ fase: 'hecho' });
    } catch (cause) {
      const mensaje = cause instanceof Error ? cause.message : 'No se pudo guardar la contraseña.';
      setError(
        /same.*password|should be different/i.test(mensaje)
          ? 'La contraseña nueva debe ser distinta de la anterior.'
          : /weak|length|characters/i.test(mensaje)
            ? 'La contraseña no cumple los requisitos del servidor.'
            : mensaje,
      );
      setEstado({ fase: 'listo' });
    }
  }

  if (estado.fase === 'preparando') {
    return (
      <div className="centrado">
        <section className="tarjeta">
          <h2>{TEXTOS[proposito].titulo}</h2>
          <p aria-live="polite">Comprobando el enlace...</p>
        </section>
      </div>
    );
  }

  if (estado.fase === 'enlace-invalido') {
    return (
      <div className="centrado">
        <section className="tarjeta">
          <h2>{TEXTOS[proposito].titulo}</h2>
          <div className="aviso atencion" role="alert">
            <p>
              <strong>Enlace no válido.</strong> {estado.motivo}
            </p>
            <p>Solicite uno nuevo: los enlaces caducan y sirven una sola vez.</p>
          </div>
          <div className="acciones">
            <button type="button" onClick={() => void navigate('/recuperar')}>
              Solicitar otro enlace
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (estado.fase === 'hecho') {
    return (
      <div className="centrado">
        <section className="tarjeta">
          <h2>{TEXTOS[proposito].titulo}</h2>
          <div className="aviso exito" role="status">
            <p>
              <strong>{TEXTOS[proposito].exito}</strong>
            </p>
          </div>
          <div className="acciones">
            <button type="button" onClick={() => void navigate('/')}>
              Ir a la aplicación
            </button>
          </div>
        </section>
      </div>
    );
  }

  const guardando = estado.fase === 'guardando';

  return (
    <div className="centrado">
      <section className="tarjeta">
        <h2>{TEXTOS[proposito].titulo}</h2>
        <p className="ayuda">{TEXTOS[proposito].entrada}</p>

        <form onSubmit={onSubmit} noValidate>
          <div className="campo">
            <label htmlFor="password-nueva">
              {proposito === 'invite' ? 'Contraseña' : 'Contraseña nueva'}
            </label>
            <input
              id="password-nueva"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={guardando}
              aria-describedby="requisitos"
            />
            <ul className="ayuda" id="requisitos" style={{ paddingLeft: '1.1rem', marginTop: '0.4rem' }}>
              {PASSWORD_RULES.map((regla) => (
                <li key={regla}>{regla}</li>
              ))}
            </ul>
          </div>

          <div className="campo">
            <label htmlFor="password-repetida">Repita la contraseña</label>
            <input
              id="password-repetida"
              type="password"
              autoComplete="new-password"
              required
              value={repetida}
              onChange={(e) => setRepetida(e.target.value)}
              disabled={guardando}
              aria-invalid={repetida !== '' && !coinciden}
            />
            {repetida !== '' && !coinciden ? (
              <p className="ayuda" style={{ color: 'var(--error-borde)' }}>
                Las dos contraseñas no coinciden.
              </p>
            ) : null}
          </div>

          {password !== '' && !comprobacion.ok ? (
            <div className="aviso atencion">
              <p>Falta por cumplir:</p>
              <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>
                {comprobacion.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <div className="aviso error" role="alert">
              <p>{error}</p>
            </div>
          ) : null}

          <button type="submit" disabled={!puedeEnviar || guardando}>
            {guardando ? 'Guardando...' : 'Guardar contraseña'}
          </button>
        </form>

        <p className="ayuda" style={{ marginTop: '1rem' }}>
          <Link to="/acceder">Volver al inicio de sesión</Link>
        </p>
      </section>
    </div>
  );
}
