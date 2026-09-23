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
