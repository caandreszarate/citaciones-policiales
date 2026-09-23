import { describe, it, expect, vi, beforeEach } from 'vitest';
import { planBlocks, blockKey, newIdempotencyKey, exportFileName } from '../src/features/issuing.ts';
import { MAX_BATCH_QUANTITY } from '../src/lib/api.ts';

describe('division en bloques', () => {
  it('una peticion pequena es un solo bloque', () => {
    expect(planBlocks(1)).toEqual([1]);
    expect(planBlocks(50)).toEqual([50]);
    expect(planBlocks(MAX_BATCH_QUANTITY)).toEqual([MAX_BATCH_QUANTITY]);
  });

  it('una peticion grande se divide sin perder ni repetir citaciones', () => {
    const bloques = planBlocks(1250);
    expect(bloques).toEqual([500, 500, 250]);
    expect(bloques.reduce((a, b) => a + b, 0)).toBe(1250);
    expect(bloques.every((b) => b <= MAX_BATCH_QUANTITY)).toBe(true);
  });

  it('no impone un limite total a la persona usuaria', () => {
    const bloques = planBlocks(10_000);
    expect(bloques.reduce((a, b) => a + b, 0)).toBe(10_000);
  });
});

describe('claves de idempotencia', () => {
  it('cada bloque deriva una clave estable de la del intento', () => {
    expect(blockKey('lote-abc', 0)).toBe('lote-abc#0');
    expect(blockKey('lote-abc', 3)).toBe('lote-abc#3');
    // Estable: el mismo intento y bloque dan siempre la misma clave, que es lo
    // que permite reintentar sin consumir consecutivos nuevos.
    expect(blockKey('lote-abc', 3)).toBe(blockKey('lote-abc', 3));
  });

  it('los bloques de un intento no comparten clave', () => {
    const claves = new Set(Array.from({ length: 20 }, (_, i) => blockKey('lote-x', i)));
    expect(claves.size).toBe(20);
  });

  it('cada intento nuevo tiene su propia clave, larga y unica', () => {
    const claves = new Set(Array.from({ length: 200 }, () => newIdempotencyKey()));
    expect(claves.size).toBe(200);
    for (const c of claves) expect(c.length).toBeGreaterThanOrEqual(8);
  });
});

describe('nombres de archivo', () => {
  it('describe el intervalo del lote', () => {
    expect(exportFileName('SMII', '2026-SMII-0000124', '2026-SMII-0000173', 'pdf')).toBe(
      'citaciones_SMII_2026-SMII-0000124_a_2026-SMII-0000173.pdf',
    );
  });

  it('para una sola citacion no repite el codigo', () => {
    expect(exportFileName('BN', '2026-BN-0000001', '2026-BN-0000001', 'docx')).toBe(
      'citaciones_BN_2026-BN-0000001.docx',
    );
  });
});

// ---------------------------------------------------------------------------
// Estados de la consulta publica. Se simula el cliente de Supabase para poder
// provocar cada caso, incluido el fallo de red.
// ---------------------------------------------------------------------------

/**
 * Doble del cliente de Supabase.
 *
 * Se usa una funcion normal en vez de vi.fn(): el seguimiento de resultados de
 * vi.fn() engancha las promesas devueltas y convierte un rechazo ya capturado en
 * un fallo del proceso, lo que impedia probar precisamente el caso que mas
 * importa aqui, el de la red caida.
 */
const stub = vi.hoisted(() => ({
  impl: (..._args: unknown[]): unknown => undefined,
  calls: [] as unknown[][],
}));

vi.mock('../src/lib/supabase.ts', () => {
  const rpc = (...args: unknown[]) => {
    stub.calls.push(args);
    return stub.impl(...args);
  };
  return { supabase: { rpc }, requireSupabase: () => ({ rpc }) };
});

/** Respuesta del servidor para la siguiente llamada. */
function responder(value: unknown): void {
  stub.impl = () => Promise.resolve(value);
}

const TOKEN_VALIDO = '0123456789abcdef0123456789abcdef';

describe('consulta publica', () => {
  beforeEach(() => {
    stub.calls.length = 0;
    stub.impl = () => undefined;
  });

  async function consultar(token: string) {
    const { verifyIssuance } = await import('../src/lib/api.ts');
    return verifyIssuance(token);
  }

  it('distingue una emision registrada', async () => {
    responder({
      data: [
        {
          registration_code: '2026-SMII-0000124',
          station_code: 'SMII',
          station_name: 'Comisaria de Santamaria II',
          issued_at: '2026-03-05T08:00:00Z',
          status: 'registrada',
        },
      ],
      error: null,
    });
    const r = await consultar(TOKEN_VALIDO);
    expect(r.kind).toBe('registrada');
    if (r.kind === 'registrada') {
      expect(r.data.registrationCode).toBe('2026-SMII-0000124');
      expect(r.data.stationName).toBe('Comisaria de Santamaria II');
    }
  });

  it('distingue una emision anulada', async () => {
    responder({
      data: [
        {
          registration_code: '2026-SMII-0000125',
          station_code: 'SMII',
          station_name: 'Comisaria de Santamaria II',
          issued_at: '2026-03-05T08:00:00Z',
          status: 'anulada',
        },
      ],
      error: null,
    });
    expect((await consultar(TOKEN_VALIDO)).kind).toBe('anulada');
  });

  it('distingue un registro inexistente de un fallo', async () => {
    responder({ data: [], error: null });
    expect((await consultar(TOKEN_VALIDO)).kind).toBe('inexistente');
  });

  it('un token con formato invalido es inexistente, no un fallo', async () => {
    expect((await consultar('no-es-un-token')).kind).toBe('inexistente');
    expect(stub.calls).toHaveLength(0);
  });

  it('un fallo de red es "servicio no disponible", nunca "documento falso"', async () => {
    stub.impl = () => Promise.reject(new TypeError('Failed to fetch'));
    const r = await consultar(TOKEN_VALIDO);
    expect(r.kind).toBe('no-disponible');
    if (r.kind === 'no-disponible') expect(r.detail).toContain('Failed to fetch');
  });

  it('un error del servicio tampoco se presenta como inexistente', async () => {
    responder({ data: null, error: { message: 'service unavailable' } });
    expect((await consultar(TOKEN_VALIDO)).kind).toBe('no-disponible');
  });

  it('la consulta solo devuelve los cuatro datos previstos', async () => {
    responder({
      data: [
        {
          registration_code: '2026-BN-0000001',
          station_code: 'BN',
          station_name: 'Comisaria Bioko Norte',
          issued_at: '2026-03-05T08:00:00Z',
          status: 'registrada',
        },
      ],
      error: null,
    });
    const r = await consultar(TOKEN_VALIDO);
    expect(r.kind).toBe('registrada');
    if (r.kind === 'registrada') {
      expect(Object.keys(r.data).sort()).toEqual([
        'issuedAt',
        'registrationCode',
        'stationCode',
        'stationName',
        'status',
      ]);
    }
  });
});
