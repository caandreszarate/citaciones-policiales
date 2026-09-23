-- Comisarias iniciales. Los codigos son estables: cambiarlos invalidaria codigos
-- de registro ya impresos. Reejecutable: actualiza el nombre pero nunca el contador.
insert into public.stations (code, name) values
  ('SMII', 'Comisaria de Santamaria II'),
  ('BN',   'Comisaria Bioko Norte'),
  ('SEM',  'Comisaria de Semu'),
  ('BAN',  'Comisaria de Banapa'),
  ('KM5',  'Comisaria de Kilometro 5')
on conflict (code) do update set name = excluded.name;
