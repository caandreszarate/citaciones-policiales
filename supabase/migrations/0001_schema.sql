-- =============================================================================
-- Citaciones policiales - esquema base
--
-- Principios:
--   * El navegador NUNCA calcula consecutivos ni fechas de emision.
--   * Toda emision pasa por issue_batch(), transaccional e idempotente.
--   * No se almacena ningun dato de la persona citada: el formato se imprime en
--     blanco y se rellena a mano.
-- =============================================================================

-- Supabase ya trae pgcrypto en el esquema `extensions`. Se declara igualmente
-- para que un PostgreSQL limpio quede en el mismo estado.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Perfiles: quien puede emitir. No hay registro publico de usuarios; las cuentas
-- se crean desde el panel de Supabase y se autorizan aqui.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Personas autorizadas. is_admin = puede emitir y anular en todas las comisarias.';

-- -----------------------------------------------------------------------------
-- Comisarias y su contador. last_sequence NUNCA se reinicia, ni al cambiar de ano.
-- -----------------------------------------------------------------------------
create table if not exists public.stations (
  code          text primary key,
  name          text not null,
  last_sequence bigint not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint stations_code_format check (code ~ '^[A-Z0-9]{1,10}$'),
  constraint stations_sequence_non_negative check (last_sequence >= 0)
);

comment on column public.stations.last_sequence is
  'Ultimo consecutivo entregado. Monotono y perpetuo: no se reinicia al cambiar de ano.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'issuance_status') then
    create type public.issuance_status as enum ('registrada', 'anulada');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Lotes. Una emision suelta es simplemente un lote de una citacion, de modo que
-- solo existe un camino de codigo para asignar consecutivos.
-- -----------------------------------------------------------------------------
create table if not exists public.batches (
  id              uuid primary key default gen_random_uuid(),
  station_code    text not null references public.stations (code),
  quantity        integer not null,
  first_sequence  bigint not null,
  last_sequence   bigint not null,
  year            integer not null,
  created_at      timestamptz not null default now(),
  created_by      uuid not null references auth.users (id),
  idempotency_key text not null,

  constraint batches_quantity_positive check (quantity > 0),
  constraint batches_range_coherent check (last_sequence = first_sequence + quantity - 1),
  constraint batches_first_positive check (first_sequence > 0),
  constraint batches_year_range check (year between 2000 and 9999)
);

create unique index if not exists batches_idempotency_key_key
  on public.batches (idempotency_key);
create index if not exists batches_station_created_idx
  on public.batches (station_code, created_at desc);
create index if not exists batches_created_idx
  on public.batches (created_at desc);

comment on table public.batches is
  'Lote de emision. Reserva un intervalo contiguo de consecutivos de una comisaria.';

-- -----------------------------------------------------------------------------
-- Emisiones. Una fila = una pagina impresa, con su registro y su QR propios.
-- -----------------------------------------------------------------------------
create table if not exists public.issuances (
  id                 uuid primary key default gen_random_uuid(),
  batch_id           uuid not null references public.batches (id) on delete restrict,
  station_code       text not null references public.stations (code),
  sequence           bigint not null,
  year               integer not null,
  registration_code  text not null,
  verification_token text not null,
  issued_at          timestamptz not null default now(),
  issued_by          uuid not null references auth.users (id),
  status             public.issuance_status not null default 'registrada',
  annulled_at        timestamptz,
  annulled_by        uuid references auth.users (id),
  annulment_reason   text,

  constraint issuances_sequence_positive check (sequence > 0),
  constraint issuances_year_range check (year between 2000 and 9999),
  constraint issuances_code_format check (registration_code ~ '^[0-9]{4}-[A-Z0-9]{1,10}-[0-9]{7,}$'),
  constraint issuances_token_format check (verification_token ~ '^[0-9a-f]{32}$'),
  constraint issuances_annulment_consistent check (
    (status = 'anulada' and annulled_at is not null and annulled_by is not null)
    or (status = 'registrada' and annulled_at is null and annulled_by is null)
  )
);

-- Unicidad: el nucleo de "nunca dos veces el mismo numero".
create unique index if not exists issuances_station_sequence_key
  on public.issuances (station_code, sequence);
create unique index if not exists issuances_registration_code_key
  on public.issuances (registration_code);
create unique index if not exists issuances_verification_token_key
  on public.issuances (verification_token);

create index if not exists issuances_batch_sequence_idx
  on public.issuances (batch_id, sequence);
create index if not exists issuances_station_issued_at_idx
  on public.issuances (station_code, issued_at desc);
create index if not exists issuances_issued_at_idx
  on public.issuances (issued_at desc);

comment on table public.issuances is
  'Emisiones de formatos en blanco. No contiene datos de la persona citada.';
