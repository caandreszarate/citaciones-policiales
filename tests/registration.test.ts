import { describe, it, expect } from 'vitest';
import {
  formatSequence,
  formatRegistrationCode,
  parseRegistrationCode,
  currentYearInMalabo,
  formatMalaboDateTime,
} from '../src/domain/registration.ts';
import { STATIONS, findStation, isStationCode, stationName } from '../src/domain/stations.ts';

describe('formato del codigo de registro', () => {
  it('rellena hasta siete digitos', () => {
    expect(formatSequence(1)).toBe('0000001');
    expect(formatSequence(123)).toBe('0000123');
    expect(formatSequence(9999999)).toBe('9999999');
  });

  it('no trunca numeros de mas de siete digitos', () => {
    // El fallo clasico: lpad/slice recortando por la izquierda.
    expect(formatSequence(10000000)).toBe('10000000');
    expect(formatSequence(123456789)).toBe('123456789');
    expect(formatSequence(10000000n)).toBe('10000000');
  });

  it('rechaza consecutivos invalidos', () => {
    expect(() => formatSequence(0)).toThrow(RangeError);
    expect(() => formatSequence(-5)).toThrow(RangeError);
  });

  it('compone el codigo completo', () => {
    expect(formatRegistrationCode(2026, 'SMII', 1)).toBe('2026-SMII-0000001');
    expect(formatRegistrationCode(2027, 'SMII', 124)).toBe('2027-SMII-0000124');
  });

  it('ida y vuelta', () => {
    const parsed = parseRegistrationCode('2027-KM5-0000124');
    expect(parsed).toEqual({ year: 2027, stationCode: 'KM5', sequence: 124n });
    expect(parseRegistrationCode('2026-SMII-123')).toBeNull(); // menos de 7 digitos
    expect(parseRegistrationCode('cualquier cosa')).toBeNull();
  });

  it('acepta un consecutivo que cruza de ano sin reiniciarse', () => {
    // Regla: tras 2026-SMII-0000123 puede venir 2027-SMII-0000124.
    expect(formatRegistrationCode(2026, 'SMII', 123)).toBe('2026-SMII-0000123');
    expect(formatRegistrationCode(2027, 'SMII', 124)).toBe('2027-SMII-0000124');
  });
});

describe('zona horaria', () => {
  it('usa Africa/Malabo para el ano', () => {
    // 2026-01-01 00:30 UTC es todavia 2026 en Malabo (UTC+1 -> 01:30).
    expect(currentYearInMalabo(new Date('2026-01-01T00:30:00Z'))).toBe(2026);
    // 2025-12-31 23:30 UTC ya es 2026 en Malabo (00:30 del dia 1).
    expect(currentYearInMalabo(new Date('2025-12-31T23:30:00Z'))).toBe(2026);
  });

  it('presenta las fechas en hora de Malabo', () => {
    const shown = formatMalaboDateTime('2026-03-05T08:00:00Z');
    expect(shown).toContain('9:00:00'); // UTC+1
  });
});

describe('comisarias', () => {
  it('centraliza las cinco comisarias iniciales', () => {
    expect(STATIONS.map((s) => s.code)).toEqual(['SMII', 'BN', 'SEM', 'BAN', 'KM5']);
    expect(findStation('SMII')?.name).toBe('Comisaria de Santamaria II');
  });

  it('reconoce codigos validos', () => {
    expect(isStationCode('KM5')).toBe(true);
    expect(isStationCode('XXX')).toBe(false);
  });

  it('no inventa nombres para comisarias desconocidas', () => {
    expect(stationName('DESCONOCIDA')).toBe('DESCONOCIDA');
    expect(stationName('DESCONOCIDA', 'Nombre del servidor')).toBe('Nombre del servidor');
  });
});
