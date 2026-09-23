/**
 * Arranque de una base de datos de pruebas con las migraciones REALES.
 *
 * Supabase aporta el esquema `auth` y la funcion `auth.uid()`. Aqui se sustituyen
 * por un equivalente minimo que lee el usuario de una variable de sesion, de modo
 * que las pruebas pueden cambiar de identidad y comprobar la autorizacion.
 *
 * Todos los datos son ficticios.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client, Pool } from 'pg';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');

/** Reemplazo de prueba del esquema `auth` de Supabase. */
const AUTH_STUB = `
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- auth.uid() de Supabase lee el JWT; aqui leemos una variable de sesion.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.user_id', true), '')::uuid
$$;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;
`;

export interface TestDb {
  readonly pool: Pool;
  /** Ejecuta una consulta como un usuario concreto (o anonimo si es null). */
  asUser<T = unknown>(userId: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  /** Crea una cuenta ficticia. `admin` decide si queda autorizada para emitir. */
  createUser(email: string, admin: boolean): Promise<string>;
  close(): Promise<void>;
}

export function baseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const script = join(import.meta.dirname, '..', '..', 'scripts', 'test-db.sh');
  return execFileSync(script, ['start'], { encoding: 'utf8' }).trim();
}

/** Crea una base de datos limpia y aplica las migraciones en orden. */
export async function createTestDb(name: string): Promise<TestDb> {
  const root = baseUrl();
  const admin = new Client({ connectionString: root });
  await admin.connect();
  const dbName = `citaciones_test_${name}_${Date.now().toString(36)}`;
  await admin.query(`drop database if exists ${dbName}`);
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = root.replace(/\/[^/]*$/, `/${dbName}`);
  const pool = new Pool({ connectionString: url, max: 12 });

  const setup = await pool.connect();
  try {
    await setup.query('create extension if not exists pgcrypto');
    await setup.query(AUTH_STUB);
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      await setup.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    }
  } finally {
    setup.release();
  }

  return {
    pool,
    async asUser<T>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
      const client = await pool.connect();
      try {
        // set_config local a la transaccion implicita de la sesion prestada.
        await client.query('select set_config($1, $2, false)', ['test.user_id', userId ?? '']);
        // Las funciones son SECURITY DEFINER, pero comprobamos ademas los GRANT y
        // las politicas RLS ejecutando con el rol correspondiente.
        await client.query(`set role ${userId ? 'authenticated' : 'anon'}`);
        const result = await client.query(sql, params);
        return result.rows as T[];
      } finally {
        await client.query('reset role').catch(() => undefined);
        client.release();
      }
    },
    async createUser(email: string, isAdmin: boolean): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        'insert into auth.users (email) values ($1) returning id',
        [email],
      );
      const id = rows[0]!.id;
      await pool.query(
        `insert into public.profiles (id, full_name, is_admin) values ($1, $2, $3)
         on conflict (id) do update set is_admin = excluded.is_admin`,
        [id, email, isAdmin],
      );
      return id;
    },
    async close() {
      await pool.end();
    },
  };
}
