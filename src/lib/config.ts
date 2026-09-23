/**
 * Configuracion de entorno. Solo variables VITE_*, que son PUBLICAS por
 * definicion: la clave anonima de Supabase esta pensada para el navegador y solo
 * puede hacer lo que permiten RLS y los GRANT de las funciones.
 *
 * Nunca debe aparecer aqui la service_role key ni ninguna credencial privilegiada.
 */

interface AppConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  /** Base de la URL de consulta publica que se codifica en el QR. */
  readonly verifyBaseUrl: string;
  readonly isConfigured: boolean;
}

function readEnv(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  return typeof value === 'string' ? value.trim() : '';
}

const supabaseUrl = readEnv('VITE_SUPABASE_URL');
const supabaseAnonKey = readEnv('VITE_SUPABASE_ANON_KEY');

/**
 * URL de consulta. Configurable para que el QR siga siendo valido si la
 * aplicacion cambia de dominio. Si no se define, se deduce de donde se sirve la
 * aplicacion, respetando la subruta de GitHub Pages (import.meta.env.BASE_URL).
 */
function defaultVerifyBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const base = import.meta.env.BASE_URL || '/';
  return new URL(base, window.location.origin).href.replace(/\/$/, '');
}

const verifyBaseUrl = (readEnv('VITE_VERIFY_BASE_URL') || defaultVerifyBaseUrl()).replace(/\/$/, '');

export const config: AppConfig = {
  supabaseUrl,
  supabaseAnonKey,
  verifyBaseUrl,
  isConfigured: supabaseUrl !== '' && supabaseAnonKey !== '',
};

/** URL completa de consulta para un token. Es lo unico que contiene el QR. */
export function verificationUrl(token: string): string {
  return `${config.verifyBaseUrl}/#/verificar/${token}`;
}
