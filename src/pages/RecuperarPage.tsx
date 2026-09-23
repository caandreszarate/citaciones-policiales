import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.ts';
import { config } from '../lib/config.ts';

/**
 * Solicitud del correo de recuperacion.
 *
 * El mensaje de respuesta es SIEMPRE el mismo, exista o no la cuenta: decir
 * "ese correo no está registrado" permitiria averiguar quien tiene cuenta. Es
 * tambien lo que hace Supabase, que responde correctamente en ambos casos.
 */
export function RecuperarPage() {
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (enviando || enviado) return;

    setEnviando(true);
    setError(null);
    try {
      if (!supabase) throw new Error('La aplicación no está configurada.');

      // El retorno apunta a la raiz de la aplicacion: main.tsx lee los
      // parametros del enlace antes de montar el router y encamina a
      // RECOVERY_ROUTE. Asi funciona bajo la subruta de GitHub Pages.
      const { error: fallo } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${config.verifyBaseUrl}/`,
      });
      if (fallo) throw new Error(fallo.message);
      setEnviado(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `No se pudo enviar el correo: ${cause.message}`
          : 'No se pudo enviar el correo.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="centrado">
      <section className="tarjeta">
        <h2>Recuperar contraseña</h2>

        {enviado ? (
          <div className="aviso exito" role="status">
            <p>
              <strong>Correo enviado.</strong> Si <code>{email.trim()}</code> corresponde a una
              cuenta del sistema, recibirá un mensaje con un enlace para establecer una contraseña
              nueva.
            </p>
            <p>
              El enlace <strong>caduca</strong> y sirve <strong>una sola vez</strong>. Revise
              también la carpeta de correo no deseado.
            </p>
          </div>
        ) : (
          <>
            <p className="ayuda">
              Indique el correo de su cuenta y le enviaremos un enlace para establecer una
              contraseña nueva.
            </p>

            <form onSubmit={onSubmit} noValidate>
              <div className="campo">
                <label htmlFor="email-recuperar">Correo electrónico</label>
                <input
                  id="email-recuperar"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={enviando}
                />
              </div>

              {error ? (
                <div className="aviso error" role="alert">
                  <p>{error}</p>
                </div>
              ) : null}

              <button type="submit" disabled={enviando || email.trim() === ''}>
                {enviando ? 'Enviando...' : 'Enviar enlace'}
              </button>
            </form>
          </>
        )}

        <p className="ayuda" style={{ marginTop: '1rem' }}>
          <Link to="/acceder">Volver al inicio de sesión</Link>
        </p>
      </section>
    </div>
  );
}
