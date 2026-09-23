-- =============================================================================
-- Corrige el search_path de issue_batch.
--
-- En Supabase, pgcrypto se instala en el esquema `extensions`, no en `public`.
-- La funcion se creo con `set search_path = public, pg_catalog`, de modo que
-- gen_random_bytes() no se resolvia y la emision fallaba con:
--
--   ERROR 42883: function gen_random_bytes(integer) does not exist
--
-- Solo se manifestaba en el proyecto real: el entorno de pruebas instalaba
-- pgcrypto en `public`. Ahora las pruebas lo reproducen (tests/support/testDb.ts
-- lo instala en `extensions`, como Supabase).
--
-- 0003_functions.sql ya viene corregida para instalaciones nuevas; esta
-- migracion existe para los proyectos donde 0003 ya se habia aplicado.
-- =============================================================================

alter function public.issue_batch(text, integer, text)
  set search_path = public, extensions, pg_catalog;
