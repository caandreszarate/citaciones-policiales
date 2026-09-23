/**
 * Formato del codigo de registro: AAAA-CODIGO-NNNNNNN
 *
 * Reglas (ver docs/especificacion.md):
 *  - El ano es el ano de la emision en Africa/Malabo.
 *  - El consecutivo pertenece a la comisaria y NUNCA se reinicia, tampoco al
 *    cambiar de ano: tras 2026-SMII-0000123 puede venir 2027-SMII-0000124.
 *  - Minimo 7 digitos, rellenando con ceros, pero sin truncar numeros mayores.
 *
 * Esta funcion existe para FORMATEAR y VALIDAR. El consecutivo lo asigna siempre
 * el servidor (funcion SQL `issue_citation`); el navegador nunca lo calcula.
 */

export const SEQUENCE_MIN_DIGITS = 7;

export const REGISTRATION_CODE_PATTERN = /^(\d{4})-([A-Z0-9]{1,10})-(\d{7,})$/;

export function formatSequence(sequence: number | bigint): string {
  const value = typeof sequence === 'bigint' ? sequence : BigInt(Math.trunc(sequence));
  if (value < 1n) {
    throw new RangeError(`El consecutivo debe ser mayor o igual que 1 (recibido: ${value}).`);
  }
  // padStart no trunca: un numero de mas de 7 digitos se conserva completo.
  return value.toString().padStart(SEQUENCE_MIN_DIGITS, '0');
}

export function formatRegistrationCode(
  year: number,
  stationCode: string,
  sequence: number | bigint,
): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError(`Ano invalido: ${year}.`);
  }
  return `${year}-${stationCode}-${formatSequence(sequence)}`;
}

export interface ParsedRegistrationCode {
  readonly year: number;
  readonly stationCode: string;
  readonly sequence: bigint;
}

export function parseRegistrationCode(code: string): ParsedRegistrationCode | null {
  const match = REGISTRATION_CODE_PATTERN.exec(code);
  if (!match) return null;
  const [, year, stationCode, sequence] = match;
  return {
    year: Number(year),
    stationCode: stationCode as string,
    sequence: BigInt(sequence as string),
  };
}

/** Ano en curso segun la zona horaria de Guinea Ecuatorial. Solo para mostrar. */
export const MALABO_TIME_ZONE = 'Africa/Malabo';

export function currentYearInMalabo(now: Date = new Date()): number {
  const year = new Intl.DateTimeFormat('es-ES', {
    timeZone: MALABO_TIME_ZONE,
    year: 'numeric',
  }).format(now);
  return Number(year);
}

/** Presenta un instante UTC en hora local de Malabo. */
export function formatMalaboDateTime(isoUtc: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return isoUtc;
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: MALABO_TIME_ZONE,
    dateStyle: 'long',
    timeStyle: 'medium',
  }).format(date);
}
