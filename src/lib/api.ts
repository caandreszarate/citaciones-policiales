import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSupabase, supabase } from './supabase.ts';

/**
 * Respuesta de una llamada RPC. El cliente de Supabase la tipa como `any`, asi
 * que se estrecha aqui una sola vez y el resto del modulo trabaja con tipos.
 */
interface RpcResponse<T> {
  data: T | null;
  error: { message: string } | null;
}

async function callRpc<T>(
  client: SupabaseClient,
  fn: string,
  params: Record<string, unknown>,
): Promise<T | null> {
  const { data, error } = (await client.rpc(fn, params)) as RpcResponse<T>;
  if (error) throw new Error(translateError(error.message));
  return data;
}

export type IssuanceStatus = 'registrada' | 'anulada';

/** Limite tecnico POR OPERACION del servidor (public.max_batch_quantity()). */
export const MAX_BATCH_QUANTITY = 500;

export interface Batch {
  readonly id: string;
  readonly stationCode: string;
  readonly stationName: string;
  readonly quantity: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly year: number;
  readonly createdAt: string;
  /** true si el servidor devolvio un lote existente por idempotencia. */
  readonly reused: boolean;
}

interface BatchRow {
  batch_id: string;
  station_code: string;
  station_name: string;
  quantity: number;
  first_sequence: number | string;
  last_sequence: number | string;
  year: number;
  created_at: string;
  reused: boolean;
}

function toBatch(row: BatchRow): Batch {
  return {
    id: row.batch_id,
    stationCode: row.station_code,
    stationName: row.station_name,
    quantity: row.quantity,
    firstSequence: Number(row.first_sequence),
    lastSequence: Number(row.last_sequence),
    year: row.year,
    createdAt: row.created_at,
    reused: row.reused,
  };
}

/**
 * Emite un lote. Los consecutivos, el ano y la hora los asigna el servidor.
 *
 * `idempotencyKey` debe ser estable para un mismo intento: si la peticion se
 * reintenta (doble clic, red inestable, fallo al exportar) se vuelve a enviar la
 * MISMA clave y el servidor devuelve el lote ya creado en lugar de consumir
 * numeros nuevos.
 */
export async function issueBatch(
  stationCode: string,
  quantity: number,
  idempotencyKey: string,
): Promise<Batch> {
  const rows = await callRpc<BatchRow[]>(requireSupabase(), 'issue_batch', {
    p_station_code: stationCode,
    p_quantity: quantity,
    p_idempotency_key: idempotencyKey,
  });
  const row = rows?.[0];
  if (!row) throw new Error('El servidor no devolvio el lote.');
  return toBatch(row);
}

/** Emisiones de un lote, en orden de consecutivo. Fuente unica para exportar. */
export async function listBatchIssuances(batchId: string): Promise<HistoryEntry[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('issuances')
    .select(
      'id, batch_id, station_code, sequence, year, registration_code, verification_token, issued_at, status, annulled_at, annulment_reason',
    )
    .eq('batch_id', batchId)
    .order('sequence', { ascending: true });
  if (error) throw new Error(translateError(error.message));
  return (data ?? []).map(toHistoryEntry);
}

/** Lotes guardados, para volver a descargarlos sin emitir nada nuevo. */
export async function listBatches(filters: { stationCode?: string | undefined; limit?: number } = {}): Promise<BatchSummary[]> {
  const client = requireSupabase();
  let query = client
    .from('batches')
    .select('id, station_code, quantity, first_sequence, last_sequence, year, created_at')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 50);
  if (filters.stationCode) query = query.eq('station_code', filters.stationCode);

  const { data, error } = await query;
  if (error) throw new Error(translateError(error.message));
  return (data ?? []).map((r) => ({
    id: r.id as string,
    stationCode: r.station_code as string,
    quantity: r.quantity as number,
    firstSequence: Number(r.first_sequence),
    lastSequence: Number(r.last_sequence),
    year: r.year as number,
    createdAt: r.created_at as string,
  }));
}

export interface BatchSummary {
  readonly id: string;
  readonly stationCode: string;
  readonly quantity: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly year: number;
  readonly createdAt: string;
}

export interface HistoryFilters {
  readonly stationCode?: string | undefined;
  readonly status?: IssuanceStatus | undefined;
  readonly search?: string | undefined;
  readonly limit?: number;
}

export interface HistoryEntry {
  readonly id: string;
  readonly batchId: string;
  readonly stationCode: string;
  readonly sequence: number;
  readonly year: number;
  readonly registrationCode: string;
  readonly verificationToken: string;
  readonly issuedAt: string;
  readonly status: IssuanceStatus;
  readonly annulledAt: string | null;
  readonly annulmentReason: string | null;
}

/** Historial privado. Requiere sesion; RLS lo limita a cuentas administradoras. */
export async function listIssuances(filters: HistoryFilters = {}): Promise<HistoryEntry[]> {
  const client = requireSupabase();
  let query = client
    .from('issuances')
    .select(
      'id, batch_id, station_code, sequence, year, registration_code, verification_token, issued_at, status, annulled_at, annulment_reason',
    )
    .order('issued_at', { ascending: false })
    .limit(filters.limit ?? 100);

  if (filters.stationCode) query = query.eq('station_code', filters.stationCode);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.search) query = query.ilike('registration_code', `%${filters.search.trim()}%`);

  const { data, error } = await query;
  if (error) throw new Error(translateError(error.message));
  return (data ?? []).map(toHistoryEntry);
}

function toHistoryEntry(r: Record<string, unknown>): HistoryEntry {
  return {
    id: r.id as string,
    batchId: r.batch_id as string,
    stationCode: r.station_code as string,
    sequence: Number(r.sequence),
    year: r.year as number,
    registrationCode: r.registration_code as string,
    verificationToken: r.verification_token as string,
    issuedAt: r.issued_at as string,
    status: r.status as IssuanceStatus,
    annulledAt: (r.annulled_at as string | null) ?? null,
    annulmentReason: (r.annulment_reason as string | null) ?? null,
  };
}

/** Anula todas las emisiones registradas de un lote. Conserva los consecutivos. */
export async function annulBatch(batchId: string, reason: string): Promise<number> {
  const count = await callRpc<number>(requireSupabase(), 'annul_batch', {
    p_batch_id: batchId,
    p_reason: reason,
  });
  return Number(count ?? 0);
}

/** Anula una emision. Conserva la fila y su consecutivo: el numero no se reutiliza. */
export async function annulCitation(id: string, reason: string): Promise<void> {
  await callRpc<unknown>(requireSupabase(), 'annul_citation', { p_id: id, p_reason: reason });
}

// ---------------------------------------------------------------- Consulta publica

/**
 * Resultado de la consulta publica. Distingue explicitamente los cuatro casos,
 * porque un fallo de red NO significa que el documento sea falso.
 */
export type VerificationResult =
  | { kind: 'registrada'; data: PublicIssuance }
  | { kind: 'anulada'; data: PublicIssuance }
  | { kind: 'inexistente' }
  | { kind: 'no-disponible'; detail: string };

interface PublicIssuanceRow {
  registration_code: string;
  station_code: string;
  station_name: string;
  issued_at: string;
  status: IssuanceStatus;
}

export interface PublicIssuance {
  readonly registrationCode: string;
  readonly stationCode: string;
  readonly stationName: string;
  readonly issuedAt: string;
  readonly status: IssuanceStatus;
}

export async function verifyIssuance(token: string): Promise<VerificationResult> {
  if (!supabase) {
    return {
      kind: 'no-disponible',
      detail: 'La aplicacion no esta configurada para consultar el registro.',
    };
  }
  // Un token con formato invalido no se consulta, pero tampoco es un fallo de
  // servicio: sencillamente no existe ningun registro con esa forma.
  if (!/^[0-9a-f]{32}$/.test(token)) return { kind: 'inexistente' };

  try {
    const { data, error } = (await supabase.rpc('verify_issuance', {
      p_token: token,
    })) as RpcResponse<PublicIssuanceRow[]>;
    if (error) {
      return { kind: 'no-disponible', detail: error.message };
    }
    const row = data?.[0];
    if (!row) return { kind: 'inexistente' };

    const value: PublicIssuance = {
      registrationCode: row.registration_code,
      stationCode: row.station_code,
      stationName: row.station_name,
      issuedAt: row.issued_at,
      status: row.status,
    };
    return row.status === 'anulada'
      ? { kind: 'anulada', data: value }
      : { kind: 'registrada', data: value };
  } catch (cause) {
    // Error de red, DNS, CORS o servicio caido.
    return {
      kind: 'no-disponible',
      detail: cause instanceof Error ? cause.message : 'Error de conexion.',
    };
  }
}

function translateError(message: string): string {
  if (/no esta autorizada|not authorized|42501|permission denied/i.test(message)) {
    return 'La cuenta no esta autorizada para esta operacion.';
  }
  if (/Comisaria desconocida|23503/i.test(message)) {
    return 'La comisaria seleccionada no existe o esta inactiva.';
  }
  if (/idempotencia/i.test(message)) {
    return 'La clave de idempotencia ya se uso para otra comisaria. Vuelva a intentarlo.';
  }
  if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) {
    return 'No se pudo contactar con el servidor. Compruebe la conexion e intentelo de nuevo.';
  }
  return message;
}
