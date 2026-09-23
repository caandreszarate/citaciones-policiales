import { describe, it, expect } from 'vitest';
import { readRecoveryParams, describeRecoveryError, RECOVERY_ROUTE } from '../src/lib/recovery.ts';
import { checkPassword, PASSWORD_MIN_LENGTH } from '../src/domain/password.ts';

/**
 * El enlace de recuperacion y el enrutado por hash comparten el fragmento de la
 * URL, asi que esta lectura es el punto donde el flujo se rompe si algo cambia.
 */

const BASE = 'https://caandreszarate.github.io/citaciones-policiales/';

describe('lectura del enlace de recuperacion', () => {
  it('lee el flujo implicito, que llega en el fragmento', () => {
    const entrada = readRecoveryParams(
      `${BASE}#access_token=abc.def.ghi&refresh_token=rrr&expires_in=3600&token_type=bearer&type=recovery`,
    );
    expect(entrada).toEqual({
      kind: 'tokens',
      accessToken: 'abc.def.ghi',
      refreshToken: 'rrr',
      purpose: 'recovery',
    });
  });

  it('lee el flujo PKCE, que llega en la cadena de consulta', () => {
    expect(readRecoveryParams(`${BASE}?code=un-codigo-de-intercambio`)).toEqual({
      kind: 'code',
      code: 'un-codigo-de-intercambio',
      purpose: 'desconocido',
    });
  });

  it('distingue un enlace caducado', () => {
    const entrada = readRecoveryParams(
      `${BASE}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
    );
    expect(entrada?.kind).toBe('error');
    if (entrada?.kind === 'error') {
      expect(entrada.code).toBe('otp_expired');
      expect(describeRecoveryError(entrada.code, entrada.description)).toMatch(/caducado/i);
    }
  });

  it('tambien lee el error si llega en la cadena de consulta', () => {
    const entrada = readRecoveryParams(
      `${BASE}?error=access_denied&error_code=otp_expired&error_description=expired`,
    );
    expect(entrada?.kind).toBe('error');
  });

  it('no confunde una ruta normal de la aplicacion con un enlace', () => {
    expect(readRecoveryParams(`${BASE}#/acceder`)).toBeNull();
    expect(readRecoveryParams(`${BASE}#/historial`)).toBeNull();
    expect(readRecoveryParams(`${BASE}#/verificar/0123456789abcdef0123456789abcdef`)).toBeNull();
    expect(readRecoveryParams(BASE)).toBeNull();
    expect(readRecoveryParams(`${BASE}#`)).toBeNull();
  });

  it('no acepta un retorno a medias', () => {
    // Sin refresh_token no se puede establecer sesion.
    expect(readRecoveryParams(`${BASE}#access_token=solo-el-de-acceso&type=recovery`)).toBeNull();
  });

  it('distingue una invitacion de una recuperacion', () => {
    const invitacion = readRecoveryParams(`${BASE}#access_token=a&refresh_token=b&type=invite`);
    expect(invitacion).toMatchObject({ kind: 'tokens', purpose: 'invite' });

    const recuperacion = readRecoveryParams(`${BASE}#access_token=a&refresh_token=b&type=recovery`);
    expect(recuperacion).toMatchObject({ kind: 'tokens', purpose: 'recovery' });

    // Sin `type` el flujo sigue funcionando, solo cambia como se explica.
    const sinTipo = readRecoveryParams(`${BASE}#access_token=a&refresh_token=b`);
    expect(sinTipo).toMatchObject({ kind: 'tokens', purpose: 'desconocido' });
  });

  it('funciona bajo la subruta de GitHub Pages', () => {
    const entrada = readRecoveryParams(
      'https://caandreszarate.github.io/citaciones-policiales/#access_token=a&refresh_token=b',
    );
    expect(entrada?.kind).toBe('tokens');
  });

  it('la ruta de destino es la de la pantalla de nueva contrasena', () => {
    expect(RECOVERY_ROUTE).toBe('/nueva-contrasena');
  });
});

describe('mensajes de enlace no valido', () => {
  it('explica cada caso en castellano, sin tecnicismos', () => {
    expect(describeRecoveryError('otp_expired', '')).toMatch(/caducado/i);
    expect(describeRecoveryError('', 'Token has already been used')).toMatch(/ya se utilizó/i);
    expect(describeRecoveryError('access_denied', '')).toMatch(/no es válido|caducado|utilizó/i);
  });

  it('nunca deja un mensaje vacio', () => {
    expect(describeRecoveryError('', '')).not.toBe('');
  });
});

describe('politica de contrasenas', () => {
  it('exige la longitud del servidor', () => {
    expect(checkPassword('Ab1' + 'x'.repeat(PASSWORD_MIN_LENGTH - 4)).ok).toBe(false);
    expect(checkPassword('Ab1' + 'x'.repeat(PASSWORD_MIN_LENGTH - 3)).ok).toBe(true);
  });

  it('exige minuscula, mayuscula y numero', () => {
    expect(checkPassword('todominusculas1').problems).toContain('Debe incluir alguna letra mayúscula.');
    expect(checkPassword('TODOMAYUSCULAS1').problems).toContain('Debe incluir alguna letra minúscula.');
    expect(checkPassword('SinNumerosAqui').problems).toContain('Debe incluir algún número.');
  });

  it('acepta una contrasena que cumple todo', () => {
    const r = checkPassword('Comisaria2026Malabo');
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it('enumera todos los incumplimientos a la vez, no solo el primero', () => {
    expect(checkPassword('corta').problems).toHaveLength(3);
  });
});
