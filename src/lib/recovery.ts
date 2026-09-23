/**
 * Captura de los parametros del enlace de recuperacion de contrasena.
 *
 * Supabase devuelve al usuario de dos maneras distintas segun el flujo:
 *
 *   implicito : https://app/#access_token=...&refresh_token=...&type=recovery
 *   PKCE      : https://app/?code=...
 *
 * y, si el enlace ha caducado o ya se uso:
 *
 *   https://app/#error=access_denied&error_code=otp_expired&error_description=...
 *
 * El caso implicito choca con el enrutado por hash: `#access_token=...` ocuparia
 * el sitio de `#/ruta`. Por eso el cliente se crea con `detectSessionInUrl:
 * false` y la lectura se hace aqui, A MANO y ANTES de montar el router:
 * se extraen los datos, se limpia la URL y se deja el hash apuntando a la
 * pantalla de nueva contrasena.
 *
 * Se admiten los dos flujos para que el enlace funcione igual si se abre en otro
 * navegador o en otro dispositivo (donde PKCE no encontraria su verificador).
 */

export type RecoveryEntry =
  | { readonly kind: 'tokens'; readonly accessToken: string; readonly refreshToken: string }
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'error'; readonly code: string; readonly description: string };

/** Ruta interna donde se establece la nueva contrasena. */
export const RECOVERY_ROUTE = '/nueva-contrasena';

/**
 * Lee la URL actual y devuelve lo que traiga el enlace de recuperacion, o null
 * si no es un retorno de recuperacion. `location` se recibe por parametro para
 * poder probarlo sin navegador.
 */
export function readRecoveryParams(href: string): RecoveryEntry | null {
  const url = new URL(href);

  // El fragmento puede ser "#access_token=...", "#error=..." o "#/ruta".
  const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const hashParams = rawHash.startsWith('/') ? new URLSearchParams() : new URLSearchParams(rawHash);

  const hashError = hashParams.get('error') ?? url.searchParams.get('error');
  if (hashError) {
    return {
      kind: 'error',
      code: hashParams.get('error_code') ?? url.searchParams.get('error_code') ?? hashError,
      description:
        hashParams.get('error_description') ?? url.searchParams.get('error_description') ?? '',
    };
  }

  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'tokens', accessToken, refreshToken };
  }

  const code = url.searchParams.get('code');
  if (code) return { kind: 'code', code };

  return null;
}

/**
 * Se ejecuta UNA vez al arrancar, antes de montar el router. Si la URL trae un
 * retorno de recuperacion, lo guarda, limpia la URL (para que los tokens no
 * queden en la barra de direcciones ni en el historial) y deja el hash en la
 * pantalla de nueva contrasena.
 */
let captured: RecoveryEntry | null = null;

export function captureRecoveryFromUrl(): RecoveryEntry | null {
  if (typeof window === 'undefined') return null;

  const entry = readRecoveryParams(window.location.href);
  if (!entry) return null;

  captured = entry;

  // Se reescribe la URL sin los parametros sensibles y apuntando a la pantalla
  // correspondiente. replaceState evita dejarlos en el historial del navegador.
  const limpia = `${window.location.origin}${window.location.pathname}#${RECOVERY_ROUTE}`;
  window.history.replaceState(null, '', limpia);

  return entry;
}

/** Devuelve lo capturado al arrancar. Se consume una sola vez. */
export function takeRecoveryEntry(): RecoveryEntry | null {
  const entry = captured;
  captured = null;
  return entry;
}

/** Mensaje en castellano para cada motivo de enlace no valido. */
export function describeRecoveryError(code: string, description: string): string {
  if (/expired/i.test(code) || /expired/i.test(description)) {
    return 'El enlace ha caducado. Los enlaces de recuperación duran un tiempo limitado por seguridad.';
  }
  if (/used|already/i.test(code) || /used|already/i.test(description)) {
    return 'Este enlace ya se utilizó. Cada enlace sirve una sola vez.';
  }
  if (/access_denied|otp/i.test(code)) {
    return 'El enlace no es válido, ha caducado o ya se utilizó.';
  }
  return description || 'El enlace no es válido.';
}
