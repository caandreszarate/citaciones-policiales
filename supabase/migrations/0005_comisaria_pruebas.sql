-- =============================================================================
-- Comisaria de PRUEBAS
--
-- Existe para poder verificar el sistema de extremo a extremo (emitir, exportar,
-- escanear un QR) SIN gastar consecutivos de las comisarias reales, cuyos
-- contadores no se reinician nunca.
--
-- Su nombre lo deja claro en el selector, en el historial y en la consulta
-- publica: cualquiera que escanee un QR de prueba ve de que se trata.
--
-- Para retirarla cuando el sistema entre en produccion:
--
--   update public.stations set is_active = false where code = 'PRUEBA';
--
-- Desactivarla impide emitir mas citaciones con ella, pero CONSERVA las que ya
-- se emitieron y su contador. Nunca se borra: las emisiones de prueba forman
-- parte del registro y ocultarlas falsearia el historial.
-- =============================================================================
insert into public.stations (code, name) values
  ('PRUEBA', 'PRUEBAS - no usar para citaciones reales')
on conflict (code) do update set name = excluded.name;
