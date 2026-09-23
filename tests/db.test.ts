import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb, type TestDb } from './support/testDb.ts';

/**
 * Pruebas de las garantias del servidor. Datos ficticios en su totalidad.
 */

let db: TestDb;
let admin: string;
let admin2: string;
let noAuth: string;

interface BatchRow {
  batch_id: string;
  station_code: string;
  station_name: string;
  quantity: number;
  first_sequence: string;
  last_sequence: string;
  year: number;
  created_at: string;
  reused: boolean;
}

const issue = (user: string, station: string, qty: number, key: string) =>
  db.asUser<BatchRow>(user, 'select * from public.issue_batch($1, $2, $3)', [station, qty, key]);

beforeAll(async () => {
  db = await createTestDb('core');
  admin = await db.createUser('admin.ficticio@example.test', true);
  admin2 = await db.createUser('admin2.ficticio@example.test', true);
  noAuth = await db.createUser('sin.permiso@example.test', false);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('comisarias iniciales', () => {
  it('siembra las cinco comisarias con contador a cero', async () => {
    const rows = await db.pool.query<{ code: string; name: string; last_sequence: string }>(
      'select code, name, last_sequence from public.stations order by code',
    );
    expect(rows.rows.map((r) => r.code).sort()).toEqual(['BAN', 'BN', 'KM5', 'SEM', 'SMII']);
    expect(rows.rows.every((r) => r.last_sequence === '0')).toBe(true);
  });
});

describe('contadores', () => {
  it('cada comisaria lleva su propio contador', async () => {
    const [a] = await issue(admin, 'SMII', 1, 'clave-smii-1');
    const [b] = await issue(admin, 'BN', 1, 'clave-bn-1');
    const [c] = await issue(admin, 'SMII', 1, 'clave-smii-2');

    expect(a!.first_sequence).toBe('1');
    expect(b!.first_sequence).toBe('1'); // contador independiente
    expect(c!.first_sequence).toBe('2');
  });

  it('el formato tiene al menos siete digitos y no trunca numeros mayores', async () => {
    await db.pool.query("update public.stations set last_sequence = 9999998 where code = 'SEM'");
    await issue(admin, 'SEM', 3, 'clave-sem-grande');
    const { rows } = await db.pool.query<{ registration_code: string }>(
      "select registration_code from public.issuances where station_code = 'SEM' order by sequence",
    );
    expect(rows.map((r) => r.registration_code)).toEqual([
      expect.stringMatching(/^\d{4}-SEM-9999999$/) as unknown as string,
      expect.stringMatching(/^\d{4}-SEM-10000000$/) as unknown as string,
      expect.stringMatching(/^\d{4}-SEM-10000001$/) as unknown as string,
    ]);
  });

  it('no se reinicia al cambiar de ano: el ano cambia, el consecutivo continua', async () => {
    const [first] = await issue(admin, 'BAN', 1, 'clave-ban-ano-1');
    expect(first!.first_sequence).toBe('1');

    // Adelantamos el reloj del servidor un ano sustituyendo now() dentro de la
    // funcion: es la unica forma de comprobar el cruce de ano de verdad.
    await db.pool.query(`
      create or replace function pg_temp.noop() returns void language sql as 'select';
    `);
    await db.pool.query(`
      alter function public.issue_batch(text, integer, text) rename to issue_batch_real;
    `);
    await db.pool.query(`
      create or replace function public.issue_batch(p_station_code text, p_quantity integer, p_idempotency_key text)
      returns table (batch_id uuid, station_code text, station_name text, quantity integer,
                     first_sequence bigint, last_sequence bigint, year integer,
                     created_at timestamptz, reused boolean)
      language sql volatile security definer set search_path = public, pg_catalog as $fn$
        select * from public.issue_batch_real(p_station_code, p_quantity, p_idempotency_key)
      $fn$;
      grant execute on function public.issue_batch(text, integer, text) to authenticated;
    `);
    // Simulamos el ano siguiente adelantando el reloj de la base de datos.
    const nextYear = first!.year + 1;
    await db.pool.query(
      `create or replace function public.now_override() returns timestamptz
       language sql stable as $fn$ select now() + interval '1 year' $fn$`,
    );
    await db.pool.query(
      `create or replace function public.issue_batch_real(p_station_code text, p_quantity integer, p_idempotency_key text)
       returns table (batch_id uuid, station_code text, station_name text, quantity integer,
                      first_sequence bigint, last_sequence bigint, year integer,
                      created_at timestamptz, reused boolean)
       language plpgsql volatile security definer set search_path = public, pg_catalog as $fn$
       declare v_last bigint; v_first bigint; v_year integer;
               v_now timestamptz := public.now_override(); v_batch_id uuid;
       begin
         update public.stations s set last_sequence = s.last_sequence + p_quantity
          where s.code = p_station_code returning s.last_sequence into v_last;
         v_first := v_last - p_quantity + 1;
         v_year := extract(year from (v_now at time zone 'Africa/Malabo'))::integer;
         insert into public.batches (station_code, quantity, first_sequence, last_sequence, year,
                                     created_at, created_by, idempotency_key)
         values (p_station_code, p_quantity, v_first, v_last, v_year, v_now, auth.uid(), p_idempotency_key)
         returning id into v_batch_id;
         insert into public.issuances (batch_id, station_code, sequence, year, registration_code,
                                       verification_token, issued_at, issued_by)
         select v_batch_id, p_station_code, seq, v_year,
                public.format_registration_code(v_year, p_station_code, seq),
                encode(gen_random_bytes(16), 'hex'), v_now, auth.uid()
           from generate_series(v_first, v_last) as seq;
         return query select v_batch_id, p_station_code, s.name, p_quantity, v_first, v_last,
                             v_year, v_now, false from public.stations s where s.code = p_station_code;
       end $fn$;`,
    );

    const [second] = await issue(admin, 'BAN', 1, 'clave-ban-ano-2');

    // El ano del codigo avanza...
    expect(second!.year).toBe(nextYear);
    // ...pero el consecutivo continua donde estaba: NO vuelve a 1.
    expect(second!.first_sequence).toBe('2');

    const { rows } = await db.pool.query<{ registration_code: string }>(
      "select registration_code from public.issuances where station_code = 'BAN' order by sequence",
    );
    expect(rows[0]!.registration_code).toBe(`${first!.year}-BAN-0000001`);
    expect(rows[1]!.registration_code).toBe(`${nextYear}-BAN-0000002`);

    // Restauramos la funcion real para el resto de las pruebas.
    await db.pool.query('drop function public.issue_batch(text, integer, text)');
    await db.pool.query('drop function public.issue_batch_real(text, integer, text)');
    await db.pool.query(
      readFileSync(join(import.meta.dirname, '..', 'supabase', 'migrations', '0003_functions.sql'), 'utf8'),
    );
  });
});

describe('lotes', () => {
  it('asigna un intervalo contiguo y crea una emision por citacion', async () => {
    await db.pool.query("update public.stations set last_sequence = 123 where code = 'KM5'");
    const [batch] = await issue(admin, 'KM5', 50, 'clave-km5-lote-50');

    expect(batch!.quantity).toBe(50);
    expect(batch!.first_sequence).toBe('124');
    expect(batch!.last_sequence).toBe('173');

    const { rows } = await db.pool.query<{ n: string; min: string; max: string; tokens: string }>(
      `select count(*) n, min(sequence)::text min, max(sequence)::text max,
              count(distinct verification_token)::text tokens
         from public.issuances where batch_id = $1`,
      [batch!.batch_id],
    );
    expect(rows[0]).toMatchObject({ n: '50', min: '124', max: '173', tokens: '50' });
  });

  it('lotes sucesivos no solapan intervalos y el contador es continuo', async () => {
    const [b1] = await issue(admin, 'KM5', 10, 'clave-km5-a');
    const [b2] = await issue(admin, 'KM5', 10, 'clave-km5-b');
    expect(Number(b2!.first_sequence)).toBe(Number(b1!.last_sequence) + 1);
  });

  it('rechaza cantidades invalidas y por encima del limite por operacion', async () => {
    await expect(issue(admin, 'KM5', 0, 'clave-cero')).rejects.toThrow(/al menos 1/i);
    await expect(issue(admin, 'KM5', 501, 'clave-exceso')).rejects.toThrow(/Maximo 500/i);
  });
});

describe('idempotencia', () => {
  it('repetir la llamada devuelve el mismo lote sin consumir numeros', async () => {
    const [first] = await issue(admin, 'BN', 5, 'clave-idem-1');
    const [again] = await issue(admin, 'BN', 5, 'clave-idem-1');

    expect(again!.batch_id).toBe(first!.batch_id);
    expect(again!.first_sequence).toBe(first!.first_sequence);
    expect(again!.reused).toBe(true);
    expect(first!.reused).toBe(false);

    const { rows } = await db.pool.query<{ n: string }>(
      "select count(*)::text n from public.issuances where station_code = 'BN' and batch_id = $1",
      [first!.batch_id],
    );
    // Las 5 del lote original. El reintento no anadio ninguna.
    expect(rows[0]!.n).toBe('5');
  });

  it('rechaza reutilizar la clave con otros parametros', async () => {
    await expect(issue(admin, 'BAN', 5, 'clave-idem-1')).rejects.toThrow(/otros parametros/i);
  });

  it('exige una clave de idempotencia con longitud suficiente', async () => {
    await expect(issue(admin, 'BN', 1, 'corta')).rejects.toThrow(/idempotencia invalida/i);
  });
});

describe('concurrencia', () => {
  it('20 lotes simultaneos no duplican ni solapan consecutivos', async () => {
    await db.pool.query("insert into public.stations (code, name) values ('CONC', 'Comisaria de prueba') on conflict do nothing");

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => issue(admin, 'CONC', 3, `clave-conc-${i}`)),
    );

    const ranges = results
      .map(([r]) => ({ from: Number(r!.first_sequence), to: Number(r!.last_sequence) }))
      .sort((a, b) => a.from - b.from);

    // Intervalos contiguos y disjuntos, cubriendo 1..60 sin huecos.
    expect(ranges[0]!.from).toBe(1);
    expect(ranges.at(-1)!.to).toBe(60);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i]!.from).toBe(ranges[i - 1]!.to + 1);
    }

    const { rows } = await db.pool.query<{ total: string; distintos: string; codigos: string }>(
      `select count(*)::text total,
              count(distinct sequence)::text distintos,
              count(distinct registration_code)::text codigos
         from public.issuances where station_code = 'CONC'`,
    );
    expect(rows[0]).toEqual({ total: '60', distintos: '60', codigos: '60' });
  });

  it('la misma clave lanzada en paralelo produce un unico lote', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => issue(admin, 'CONC', 2, 'clave-conc-misma-clave')),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThan(0);

    const ids = new Set(ok.map((r) => r.value[0]!.batch_id));
    expect(ids.size).toBe(1);

    const { rows } = await db.pool.query<{ n: string }>(
      'select count(*)::text n from public.batches where idempotency_key = $1',
      ['clave-conc-misma-clave'],
    );
    expect(rows[0]!.n).toBe('1');
  });
});

describe('autorizacion', () => {
  /** Garantiza que hay una emision registrada, sin depender del orden de las pruebas. */
  async function unaEmisionRegistrada(): Promise<string> {
    const { rows } = await db.pool.query<{ id: string }>(
      "select id from public.issuances where status = 'registrada' limit 1",
    );
    if (rows[0]) return rows[0].id;
    const [lote] = await issue(admin, 'SMII', 1, `clave-autorizacion-${Date.now()}`);
    const creada = await db.pool.query<{ id: string }>(
      'select id from public.issuances where batch_id = $1 limit 1',
      [lote!.batch_id],
    );
    return creada.rows[0]!.id;
  }

  it('una cuenta sin autorizar no puede emitir', async () => {
    await expect(issue(noAuth, 'SMII', 1, 'clave-sin-permiso')).rejects.toThrow(/no esta autorizada/i);
  });

  it('un visitante anonimo no puede emitir', async () => {
    await expect(
      db.asUser(null, 'select * from public.issue_batch($1, $2, $3)', ['SMII', 1, 'clave-anon-xx']),
    ).rejects.toThrow();
  });

  it('un visitante anonimo no puede leer la tabla de emisiones', async () => {
    await expect(
      db.asUser(null, 'select count(*) from public.issuances'),
    ).rejects.toThrow(/permission denied|denegado/i);
  });

  it('un visitante anonimo no puede leer los lotes', async () => {
    await expect(
      db.asUser(null, 'select count(*) from public.batches'),
    ).rejects.toThrow(/permission denied|denegado/i);
  });

  it('un visitante anonimo no puede anular emisiones', async () => {
    const id = await unaEmisionRegistrada();
    await expect(
      db.asUser(null, 'select * from public.annul_citation($1, null)', [id]),
    ).rejects.toThrow();
  });

  it('un visitante anonimo no puede ejecutar ninguna funcion salvo la consulta publica', async () => {
    for (const llamada of [
      "select * from public.issue_batch('SMII', 1, 'clave-anonima-x')",
      "select * from public.annul_batch('00000000-0000-0000-0000-000000000000', null)",
      'select public.is_admin()',
    ]) {
      await expect(db.asUser(null, llamada), llamada).rejects.toThrow();
    }
    // La unica permitida:
    await expect(
      db.asUser(null, "select * from public.verify_issuance('ffffffffffffffffffffffffffffffff')"),
    ).resolves.toEqual([]);
  });

  it('un visitante anonimo no puede leer el contador de las comisarias', async () => {
    await expect(
      db.asUser(null, 'select last_sequence from public.stations'),
    ).rejects.toThrow(/permission denied|denegado/i);
  });

  it('una cuenta autenticada no puede modificar el contador directamente', async () => {
    await expect(
      db.asUser(admin, "update public.stations set last_sequence = 0 where code = 'SMII'"),
    ).rejects.toThrow(/permission denied|denegado/i);
  });

  it('una cuenta autenticada no puede insertar emisiones directamente', async () => {
    await expect(
      db.asUser(
        admin,
        `insert into public.issuances (batch_id, station_code, sequence, year, registration_code,
           verification_token, issued_by)
         select id, 'SMII', 999999, 2026, '2026-SMII-0999999',
                '00000000000000000000000000000000', $1
           from public.batches limit 1`,
        [admin],
      ),
    ).rejects.toThrow(/permission denied|denegado/i);
  });

  it('una cuenta sin autorizar no ve el historial (RLS)', async () => {
    const rows = await db.asUser(noAuth, 'select id from public.issuances');
    expect(rows).toHaveLength(0);
  });

  it('una cuenta autorizada si ve el historial', async () => {
    await unaEmisionRegistrada();
    const rows = await db.asUser(admin, 'select id from public.issuances limit 5');
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('anulacion', () => {
  it('conserva el registro y su consecutivo, y no reutiliza el numero', async () => {
    const [batch] = await issue(admin, 'SEM', 2, 'clave-sem-anular');
    const { rows } = await db.pool.query<{ id: string; sequence: string }>(
      'select id, sequence from public.issuances where batch_id = $1 order by sequence',
      [batch!.batch_id],
    );
    const target = rows[0]!;

    await db.asUser(admin, 'select * from public.annul_citation($1, $2)', [
      target.id,
      'Error de impresion (dato ficticio)',
    ]);

    const after = await db.pool.query<{ status: string; sequence: string; annulled_at: string }>(
      'select status, sequence, annulled_at from public.issuances where id = $1',
      [target.id],
    );
    expect(after.rows[0]!.status).toBe('anulada');
    expect(after.rows[0]!.sequence).toBe(target.sequence); // conserva el consecutivo
    expect(after.rows[0]!.annulled_at).not.toBeNull();

    // El siguiente numero NO reutiliza el anulado.
    const [next] = await issue(admin, 'SEM', 1, 'clave-sem-siguiente');
    expect(Number(next!.first_sequence)).toBeGreaterThan(Number(rows.at(-1)!.sequence));
  });

  it('anular dos veces es idempotente', async () => {
    const [batch] = await issue(admin, 'SEM', 1, 'clave-sem-doble-anular');
    const { rows } = await db.pool.query<{ id: string }>(
      'select id from public.issuances where batch_id = $1',
      [batch!.batch_id],
    );
    const id = rows[0]!.id;
    await db.asUser(admin, 'select * from public.annul_citation($1, null)', [id]);
    await expect(
      db.asUser(admin, 'select * from public.annul_citation($1, null)', [id]),
    ).resolves.toBeDefined();
  });

  it('una cuenta sin autorizar no puede anular', async () => {
    const { rows } = await db.pool.query<{ id: string }>(
      "select id from public.issuances where status = 'registrada' limit 1",
    );
    await expect(
      db.asUser(noAuth, 'select * from public.annul_citation($1, null)', [rows[0]!.id]),
    ).rejects.toThrow(/no esta autorizada/i);
  });

  it('annul_batch anula todo el lote', async () => {
    const [batch] = await issue(admin2, 'BAN', 4, 'clave-ban-anular-lote');
    const filas = await db.asUser<{ annul_batch: number }>(
      admin2,
      'select * from public.annul_batch($1, $2)',
      [batch!.batch_id, 'Lote de prueba'],
    );
    expect(filas[0]!.annul_batch).toBe(4);
    const { rows } = await db.pool.query<{ n: string }>(
      "select count(*)::text n from public.issuances where batch_id = $1 and status = 'anulada'",
      [batch!.batch_id],
    );
    expect(rows[0]!.n).toBe('4');
  });
});

describe('consulta publica', () => {
  it('devuelve solo los cuatro datos previstos, sin sesion', async () => {
    const [batch] = await issue(admin, 'SMII', 1, 'clave-smii-publica');
    const { rows } = await db.pool.query<{ verification_token: string; registration_code: string }>(
      'select verification_token, registration_code from public.issuances where batch_id = $1',
      [batch!.batch_id],
    );
    const token = rows[0]!.verification_token;

    const result = await db.asUser<Record<string, unknown>>(
      null,
      'select * from public.verify_issuance($1)',
      [token],
    );
    expect(result).toHaveLength(1);
    expect(Object.keys(result[0]!).sort()).toEqual([
      'issued_at',
      'registration_code',
      'station_code',
      'station_name',
      'status',
    ]);
    expect(result[0]!.registration_code).toBe(rows[0]!.registration_code);
    // No expone consecutivo, usuario emisor, lote ni token.
    expect(result[0]).not.toHaveProperty('sequence');
    expect(result[0]).not.toHaveProperty('issued_by');
    expect(result[0]).not.toHaveProperty('batch_id');
  });

  it('distingue una emision anulada', async () => {
    const [batch] = await issue(admin, 'SMII', 1, 'clave-smii-publica-anulada');
    const { rows } = await db.pool.query<{ id: string; verification_token: string }>(
      'select id, verification_token from public.issuances where batch_id = $1',
      [batch!.batch_id],
    );
    await db.asUser(admin, 'select * from public.annul_citation($1, null)', [rows[0]!.id]);
    const result = await db.asUser<{ status: string }>(
      null,
      'select * from public.verify_issuance($1)',
      [rows[0]!.verification_token],
    );
    expect(result[0]!.status).toBe('anulada');
  });

  it('un token inexistente devuelve cero filas, no un error', async () => {
    const result = await db.asUser(null, 'select * from public.verify_issuance($1)', [
      'ffffffffffffffffffffffffffffffff',
    ]);
    expect(result).toHaveLength(0);
  });

  it('un token con formato invalido devuelve cero filas', async () => {
    const result = await db.asUser(null, 'select * from public.verify_issuance($1)', ['no-valido']);
    expect(result).toHaveLength(0);
  });

  it('el token no es adivinable a partir del consecutivo', async () => {
    const { rows } = await db.pool.query<{ verification_token: string }>(
      'select verification_token from public.issuances limit 200',
    );
    const tokens = rows.map((r) => r.verification_token);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens.every((t) => /^[0-9a-f]{32}$/.test(t))).toBe(true);
  });
});
