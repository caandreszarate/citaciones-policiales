import { issueBatch, listBatchIssuances, MAX_BATCH_QUANTITY, type Batch, type HistoryEntry } from '../lib/api.ts';
import { verificationUrl } from '../lib/config.ts';
import type { CitationPdfInput } from '../lib/citationPdf.ts';

/**
 * Emision por bloques.
 *
 * El servidor limita cada operacion a MAX_BATCH_QUANTITY citaciones, por memoria
 * y por tiempo de respuesta. Eso NO limita a la persona usuaria: una peticion
 * mayor se parte en bloques consecutivos. Como el contador de la comisaria es
 * continuo, los intervalos resultantes siguen siendo contiguos entre si.
 */

export interface IssuePlan {
  readonly stationCode: string;
  readonly quantity: number;
  /** Clave base estable del intento. Cada bloque deriva la suya. */
  readonly idempotencyKey: string;
}

export interface IssueProgress {
  readonly phase: 'emitiendo' | 'recuperando';
  readonly block: number;
  readonly blocks: number;
  readonly issued: number;
  readonly total: number;
}

export function planBlocks(quantity: number): number[] {
  const blocks: number[] = [];
  let left = quantity;
  while (left > 0) {
    const size = Math.min(left, MAX_BATCH_QUANTITY);
    blocks.push(size);
    left -= size;
  }
  return blocks;
}

/** Clave de idempotencia de un bloque. Derivada, estable entre reintentos. */
export function blockKey(baseKey: string, index: number): string {
  return `${baseKey}#${index}`;
}

export interface IssueResult {
  readonly batches: Batch[];
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly quantity: number;
}

/**
 * Emite `quantity` citaciones, en tantos bloques como haga falta.
 *
 * Reintentar con la misma `idempotencyKey` recupera exactamente los mismos
 * lotes: no se consume ni un numero mas, ni siquiera si el fallo se produjo a
 * mitad de camino.
 */
export async function issueCitations(
  plan: IssuePlan,
  onProgress?: (progress: IssueProgress) => void,
): Promise<IssueResult> {
  const blocks = planBlocks(plan.quantity);
  const batches: Batch[] = [];
  let issued = 0;

  for (let i = 0; i < blocks.length; i += 1) {
    const size = blocks[i]!;
    onProgress?.({
      phase: 'emitiendo',
      block: i + 1,
      blocks: blocks.length,
      issued,
      total: plan.quantity,
    });
    batches.push(await issueBatch(plan.stationCode, size, blockKey(plan.idempotencyKey, i)));
    issued += size;
  }

  const first = batches[0]!;
  const last = batches[batches.length - 1]!;
  return {
    batches,
    firstSequence: first.firstSequence,
    lastSequence: last.lastSequence,
    quantity: issued,
  };
}

/**
 * Recupera las emisiones GUARDADAS de unos lotes y las convierte en la entrada
 * de los exportadores. Los codigos y los tokens salen siempre de la base de
 * datos, nunca de un calculo del navegador: por eso repetir una descarga, o
 * cambiar de formato, jamas crea registros nuevos.
 */
export async function loadBatchPages(
  batchIds: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<CitationPdfInput[]> {
  const entries: HistoryEntry[] = [];
  for (let i = 0; i < batchIds.length; i += 1) {
    entries.push(...(await listBatchIssuances(batchIds[i]!)));
    onProgress?.(i + 1, batchIds.length);
  }
  entries.sort((a, b) => a.sequence - b.sequence);
  return entries.map(toPage);
}

export function toPage(entry: HistoryEntry): CitationPdfInput {
  return {
    registrationCode: entry.registrationCode,
    verificationUrl: verificationUrl(entry.verificationToken),
    status: entry.status,
  };
}

/** Clave de idempotencia nueva para un intento. */
export function newIdempotencyKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `lote-${random}`;
}

/** Nombre de archivo estable y descriptivo para una descarga. */
export function exportFileName(
  stationCode: string,
  first: string,
  last: string,
  extension: 'pdf' | 'docx',
): string {
  const range = first === last ? first : `${first}_a_${last}`;
  return `citaciones_${stationCode}_${range}.${extension}`;
}
