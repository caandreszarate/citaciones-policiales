-- =============================================================================
-- Operaciones del servidor. Todo lo que escribe pasa por aqui.
-- =============================================================================

-- Limite tecnico POR OPERACION. No es un limite total para la persona usuaria:
-- la interfaz divide una peticion mayor en bloques consecutivos, y como el
-- contador es continuo los intervalos resultantes siguen siendo contiguos.
-- Documentado en README.md y docs/especificacion.md.
create or replace function public.max_batch_quantity()
returns integer language sql immutable as $$ select 500 $$;

create or replace function public.format_registration_code(
  p_year integer, p_station text, p_sequence bigint
)
returns text
language sql
immutable
as $$
  -- Minimo 7 digitos, SIN truncar numeros mayores.
  -- Cuidado: lpad() trunca cuando la cadena ya es mas larga que el ancho pedido
  -- (lpad('10000000', 7, '0') devuelve '1000000'), por eso no se usa aqui.
  select p_year::text || '-' || p_station || '-' ||
         repeat('0', greatest(0, 7 - length(p_sequence::text))) || p_sequence::text
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin
  );
$$;

-- -----------------------------------------------------------------------------
-- issue_batch: reserva un intervalo contiguo de consecutivos de una comisaria y
-- crea una emision por cada uno.
--
-- Garantias:
--   * Transaccional: el UPDATE ... RETURNING bloquea la fila de la comisaria, de
--     modo que dos lotes simultaneos obtienen intervalos disjuntos y contiguos.
--   * Idempotente: repetir la llamada con la misma p_idempotency_key devuelve el
--     MISMO lote, sin consumir numeros nuevos.
--   * El ano (Africa/Malabo) y el instante (UTC) los pone el servidor.
--   * El contador no se reinicia nunca, tampoco al cambiar de ano.
-- -----------------------------------------------------------------------------
create or replace function public.issue_batch(
  p_station_code text,
  p_quantity integer,
  p_idempotency_key text
)
returns table (
  batch_id uuid,
  station_code text,
  station_name text,
  quantity integer,
  first_sequence bigint,
  last_sequence bigint,
  year integer,
  created_at timestamptz,
  reused boolean
)
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_batch public.batches;
  v_last bigint;
  v_first bigint;
  v_year integer;
  v_now timestamptz := now();
  v_batch_id uuid;
begin
  if v_user is null or not public.is_admin() then
    raise exception 'La cuenta no esta autorizada para emitir citaciones.' using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'La cantidad debe ser al menos 1.' using errcode = '22023';
  end if;
  if p_quantity > public.max_batch_quantity() then
    raise exception 'Maximo % citaciones por operacion.', public.max_batch_quantity()
      using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Clave de idempotencia invalida.' using errcode = '22023';
  end if;

  -- Idempotencia: un reintento devuelve el lote ya creado.
  select * into v_batch from public.batches b where b.idempotency_key = p_idempotency_key;
  if found then
    if v_batch.station_code is distinct from p_station_code
       or v_batch.quantity is distinct from p_quantity then
      raise exception 'La clave de idempotencia ya se uso con otros parametros.'
        using errcode = '22023';
    end if;
    return query
      select v_batch.id, v_batch.station_code, s.name, v_batch.quantity,
             v_batch.first_sequence, v_batch.last_sequence, v_batch.year,
             v_batch.created_at, true
        from public.stations s where s.code = v_batch.station_code;
    return;
  end if;

  -- Reserva atomica del intervalo. Bloquea la comisaria hasta el commit.
  update public.stations s
     set last_sequence = s.last_sequence + p_quantity
   where s.code = p_station_code and s.is_active
   returning s.last_sequence into v_last;

  if v_last is null then
    raise exception 'Comisaria desconocida o inactiva: %', p_station_code
      using errcode = '23503';
  end if;

  v_first := v_last - p_quantity + 1;
  v_year := extract(year from (v_now at time zone 'Africa/Malabo'))::integer;

  insert into public.batches (
    station_code, quantity, first_sequence, last_sequence, year,
    created_at, created_by, idempotency_key
  ) values (
    p_station_code, p_quantity, v_first, v_last, v_year,
    v_now, v_user, p_idempotency_key
  )
  returning id into v_batch_id;

  -- Una emision por pagina, cada una con su registro y su token de consulta.
  insert into public.issuances (
    batch_id, station_code, sequence, year, registration_code,
    verification_token, issued_at, issued_by
  )
  select
    v_batch_id,
    p_station_code,
    seq,
    v_year,
    public.format_registration_code(v_year, p_station_code, seq),
    encode(gen_random_bytes(16), 'hex'),
    v_now,
    v_user
  from generate_series(v_first, v_last) as seq;

  return query
    select v_batch_id, p_station_code, s.name, p_quantity, v_first, v_last,
           v_year, v_now, false
      from public.stations s where s.code = p_station_code;
exception
  when unique_violation then
    -- Carrera con otra peticion que uso la misma clave: devolvemos la suya.
    select * into v_batch from public.batches b where b.idempotency_key = p_idempotency_key;
    if not found then raise; end if;
    return query
      select v_batch.id, v_batch.station_code, s.name, v_batch.quantity,
             v_batch.first_sequence, v_batch.last_sequence, v_batch.year,
             v_batch.created_at, true
        from public.stations s where s.code = v_batch.station_code;
end;
$$;

-- -----------------------------------------------------------------------------
-- annul_citation: conserva la fila y su consecutivo. El numero no se reutiliza
-- jamas porque el contador de la comisaria nunca retrocede.
-- -----------------------------------------------------------------------------
create or replace function public.annul_citation(p_id uuid, p_reason text default null)
returns public.issuances
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.issuances;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'La cuenta no esta autorizada para anular citaciones.' using errcode = '42501';
  end if;

  update public.issuances
     set status = 'anulada', annulled_at = now(), annulled_by = auth.uid(),
         annulment_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_id and status = 'registrada'
   returning * into v_row;

  if not found then
    -- Idempotente: si ya estaba anulada devolvemos su estado actual.
    select * into v_row from public.issuances where id = p_id;
    if not found then
      raise exception 'La emision no existe.' using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- annul_batch: anula todas las emisiones registradas de un lote.
-- -----------------------------------------------------------------------------
create or replace function public.annul_batch(p_batch_id uuid, p_reason text default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'La cuenta no esta autorizada para anular citaciones.' using errcode = '42501';
  end if;

  update public.issuances
     set status = 'anulada', annulled_at = now(), annulled_by = auth.uid(),
         annulment_reason = nullif(trim(coalesce(p_reason, '')), '')
   where batch_id = p_batch_id and status = 'registrada';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- verify_issuance: consulta PUBLICA por token. Devuelve exclusivamente los cuatro
-- datos previstos. No expone el consecutivo interno, ni el usuario emisor, ni el
-- lote, ni permite listar emisiones.
--
-- 0 filas = registro inexistente (respuesta correcta del servicio). La interfaz
-- lo distingue de un fallo de red, que nunca debe presentarse como documento falso.
-- -----------------------------------------------------------------------------
create or replace function public.verify_issuance(p_token text)
returns table (
  registration_code text,
  station_code text,
  station_name text,
  issued_at timestamptz,
  status public.issuance_status
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select i.registration_code, i.station_code, s.name, i.issued_at, i.status
    from public.issuances i
    join public.stations s on s.code = i.station_code
   where i.verification_token = p_token
     and p_token ~ '^[0-9a-f]{32}$';
$$;

-- =============================================================================
-- Permisos. Por defecto, nadie toca las tablas directamente.
-- =============================================================================
revoke all on public.issuances from anon, authenticated;
revoke all on public.batches   from anon, authenticated;
revoke all on public.stations  from anon, authenticated;
revoke all on public.profiles  from anon, authenticated;

alter table public.issuances enable row level security;
alter table public.batches   enable row level security;
alter table public.stations  enable row level security;
alter table public.profiles  enable row level security;

-- Historial privado: SOLO lectura, SOLO administradores autenticados.
-- Sin politicas de insert/update/delete, RLS las deniega todas: las emisiones
-- solo pueden crearse a traves de issue_batch().
grant select on public.issuances to authenticated;
drop policy if exists issuances_select_admin on public.issuances;
create policy issuances_select_admin on public.issuances
  for select to authenticated using (public.is_admin());

grant select on public.batches to authenticated;
drop policy if exists batches_select_admin on public.batches;
create policy batches_select_admin on public.batches
  for select to authenticated using (public.is_admin());

-- Catalogo de comisarias para el selector. anon no lo ve.
grant select on public.stations to authenticated;
drop policy if exists stations_select_authenticated on public.stations;
create policy stations_select_authenticated on public.stations
  for select to authenticated using (true);

grant select on public.profiles to authenticated;
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid());

-- Funciones expuestas a PostgREST.
revoke all on function public.issue_batch(text, integer, text) from public, anon, authenticated;
grant execute on function public.issue_batch(text, integer, text) to authenticated;

revoke all on function public.annul_citation(uuid, text) from public, anon, authenticated;
grant execute on function public.annul_citation(uuid, text) to authenticated;

revoke all on function public.annul_batch(uuid, text) from public, anon, authenticated;
grant execute on function public.annul_batch(uuid, text) to authenticated;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

revoke all on function public.format_registration_code(integer, text, bigint) from public;
grant execute on function public.format_registration_code(integer, text, bigint) to authenticated;

revoke all on function public.max_batch_quantity() from public;
grant execute on function public.max_batch_quantity() to anon, authenticated;

-- La consulta publica es lo unico que puede hacer un visitante sin cuenta.
revoke all on function public.verify_issuance(text) from public;
grant execute on function public.verify_issuance(text) to anon, authenticated;
