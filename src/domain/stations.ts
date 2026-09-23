/**
 * Fuente unica de verdad de las comisarias.
 *
 * Los codigos son identificadores estables: una vez que se ha emitido la primera
 * citacion con un codigo, NO puede cambiarse, porque forma parte de codigos de
 * registro ya impresos. La migracion `0002_seed_stations.sql` inserta exactamente
 * esta misma lista en la base de datos.
 */

export const STATION_CODES = ['SMII', 'BN', 'SEM', 'BAN', 'KM5'] as const;

export type StationCode = (typeof STATION_CODES)[number];

export interface Station {
  readonly code: StationCode;
  readonly name: string;
}

export const STATIONS: readonly Station[] = [
  { code: 'SMII', name: 'Comisaria de Santamaria II' },
  { code: 'BN', name: 'Comisaria Bioko Norte' },
  { code: 'SEM', name: 'Comisaria de Semu' },
  { code: 'BAN', name: 'Comisaria de Banapa' },
  { code: 'KM5', name: 'Comisaria de Kilometro 5' },
] as const;

const BY_CODE = new Map<string, Station>(STATIONS.map((s) => [s.code, s]));

export function isStationCode(value: string): value is StationCode {
  return BY_CODE.has(value);
}

export function findStation(code: string): Station | undefined {
  return BY_CODE.get(code);
}

/** Nombre a mostrar; si el servidor devuelve una comisaria desconocida, no inventamos. */
export function stationName(code: string, fallback?: string): string {
  return BY_CODE.get(code)?.name ?? fallback ?? code;
}
