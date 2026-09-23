-- Crea el perfil al dar de alta una cuenta desde el panel de Supabase.
-- is_admin arranca en false a proposito: hay que autorizar explicitamente.
-- El registro publico de usuarios debe estar DESACTIVADO en el proyecto
-- (Authentication > Sign In / Providers > Allow new users to sign up = off).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Perfiles de las cuentas creadas ANTES de existir el disparador.
--
-- Sin esto, una cuenta dada de alta en el panel antes de aplicar las migraciones
-- se queda sin fila en profiles y no puede autorizarse. Es idempotente, asi que
-- reaplicar la migracion no altera los permisos ya concedidos.
insert into public.profiles (id, full_name)
select u.id, nullif(u.raw_user_meta_data ->> 'full_name', '')
  from auth.users u
 on conflict (id) do nothing;
