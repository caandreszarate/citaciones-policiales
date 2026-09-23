# Citaciones policiales

Emisión de **formatos de citación policial en blanco** con un código de registro
único y un código QR individual por página.

La aplicación **no rellena la citación**. Imprime el formato vacío y le añade
sólo dos cosas —el código de registro y el QR—, ambas en los huecos que la
plantilla original ya reservaba. Nombre, DIP, domicilio, comparecencia, motivo,
número policial, firma y sello se escriben **a mano** después de imprimir.

No se recoge ni se almacena ningún dato de la persona citada.

## Qué hace

- Inicio de sesión (sin registro público).
- Selección de comisaría y cantidad.
- Emisión de lotes: el servidor asigna consecutivos de forma transaccional.
- Descarga en **PDF** (recomendado para imprimir) o **Word**, una citación por página.
- Descarga del QR suelto en PNG.
- Historial privado: volver a descargar lotes y anular emisiones.
- Consulta pública del QR, sin cuenta.

## Alcance de la verificación

El QR confirma que el sistema **emitió** ese formato y **a qué comisaría**
corresponde. No acredita los datos escritos a mano, ni la firma, ni el sello, ni
impide que alguien copie o fotografíe un QR.

## Requisitos

- Node.js 20 o superior.
- Un proyecto de Supabase (autenticación + PostgreSQL).
- Opcionales, sólo para verificar: `poppler` (leer el QR del PDF) y Docker
  (convertir el Word con LibreOffice).

## Puesta en marcha

```bash
npm ci
cp .env.example .env.local     # y rellenar
npm run dev
```

### 1. Crear el proyecto de Supabase

1. Cree un proyecto en <https://supabase.com>.
2. **Authentication → Sign In / Providers → desactive «Allow new users to sign up»**.
   No debe haber registro público.
3. Copie la URL del proyecto y la clave **anon** a `.env.local`.

### 2. Aplicar las migraciones

En **SQL Editor**, ejecute en orden los archivos de `supabase/migrations/`:

| Archivo | Qué hace |
|---|---|
| `0001_schema.sql` | Tablas `profiles`, `stations`, `batches`, `issuances` y sus restricciones de unicidad |
| `0002_seed_stations.sql` | Las cinco comisarías iniciales |
| `0003_functions.sql` | `issue_batch`, `annul_citation`, `annul_batch`, `verify_issuance`, permisos y RLS |
| `0004_profile_trigger.sql` | Crea el perfil al dar de alta una cuenta |
| `0005_comisaria_pruebas.sql` | Comisaría `PRUEBA`, para verificar sin gastar consecutivos reales |

Con la CLI de Supabase:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Las migraciones son reproducibles: volver a ejecutarlas no altera los contadores.

### 3. Crear la persona administradora

1. **Authentication → Users → Add user**, con correo y contraseña.
   No escriba la contraseña en el repositorio, ni en incidencias, ni en el chat.
2. Autorícela:

```sql
update public.profiles
   set is_admin = true, full_name = 'Nombre y apellidos'
 where id = (select id from auth.users where email = 'persona@ejemplo.test');
```

`is_admin` arranca en `false` a propósito: crear la cuenta no basta, hay que
autorizarla explícitamente.

### Añadir más cuentas administradoras

Se puede **invitar** en lugar de fijar una contraseña, para que el titular elija
la suya y nadie más la conozca:

1. **Authentication → Users → Add user → Send invitation**, con la dirección.
2. Autorícela con el `update` de arriba.

La persona recibe un correo, sigue el enlace y aterriza en la pantalla
**«Establecer su contraseña»** de la aplicación publicada. El enlace caduca y
sirve una sola vez.

> Invitar **no** habilita el registro público: `disable_signup` sigue activo y un
> intento de alta responde `422 Signups not allowed for this instance`.

### Si alguien olvida su contraseña

En la pantalla de acceso, **«¿Olvidó su contraseña?»**. La respuesta es la misma
exista o no la cuenta, para no revelar qué direcciones están registradas.

> El correo integrado de Supabase está limitado a **2 mensajes por hora** y puede
> acabar en la carpeta de correo no deseado. Para uso real conviene configurar un
> SMTP propio en **Project Settings → Authentication → SMTP Settings**.

### 4. Publicar en GitHub Pages

1. **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Secrets**, añada
   `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
3. Opcional, en **Variables**: `VITE_VERIFY_BASE_URL` con la URL pública, para
   fijar la base de los QR aunque cambie el dominio.
4. `git push` a `main` dispara el despliegue.

En Supabase, añada la URL publicada a **Authentication → URL Configuration →
Redirect URLs**.

> El despliegue falla a propósito si faltan los secretos, en lugar de publicar
> una aplicación que no puede emitir ni consultar.

## Operación

### Emitir

Elija comisaría y cantidad y pulse **Generar citaciones**. El servidor asigna el
intervalo; después descargue el PDF o el Word.

Si algo falla a mitad, pulse otra vez: el intento conserva su clave de
idempotencia y se recupera **el mismo lote**, sin consumir consecutivos nuevos.

Por encima de 500 citaciones la petición se divide en bloques consecutivos, con
indicación del avance. Los intervalos siguen siendo contiguos.

### Volver a descargar

Desde **Historial → Lotes**. Se reutilizan los registros y los QR guardados: no
se emite nada nuevo, ni al cambiar de formato ni al repetir la descarga.

### Anular

Desde el historial, con confirmación y motivo. La anulación **conserva** el
registro y su consecutivo; el número **no se reutiliza jamás**. La consulta
pública pasa a mostrar «Emisión anulada».

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Compilación de producción |
| `npm run lint` | ESLint con información de tipos |
| `npm run typecheck` | Comprobación de tipos |
| `npm test` | Todas las pruebas |
| `npm run test:db` | Sólo las de base de datos |
| `npm run pdf:preview -- salida.pdf` | PDF de muestra con datos ficticios |
| `npm run pdf:check` | Genera un PDF y lee su QR desde la página rasterizada |
| `npm run docx:check -- 3` | Genera un Word, lo convierte con LibreOffice y lee los QR |
| `npm run docx:template` | Regenera la plantilla incrustada desde el DOCX original |
| `npm run db:start` / `db:stop` | PostgreSQL desechable para las pruebas |

Las pruebas de base de datos aplican las **migraciones reales**. Usan
`DATABASE_URL` si está definida; si no, levantan un PostgreSQL local con
`scripts/test-db.sh`. Todos los datos son ficticios.

## Pruebas sobre el sistema publicado

Use la comisaría **`PRUEBA`** («PRUEBAS - no usar para citaciones reales»). Tiene
su propio contador, así que las cinco comisarías reales se quedan en cero hasta
la primera emisión de verdad.

Cuando el sistema entre en producción, retírela:

```sql
update public.stations set is_active = false where code = 'PRUEBA';
```

No borre emisiones de prueba ni reinicie contadores para ocultarlas: forman parte
del registro, y el sistema está construido justamente para que los consecutivos
no retrocedan nunca.

## Copia de seguridad y recuperación

Lo que no puede perderse es la **correspondencia entre códigos impresos y
registros**, y sobre todo el **contador** de cada comisaría: si retrocede, se
repetirían números ya impresos.

### Copia

Supabase hace copias automáticas (Database → Backups). Añada una copia propia:

```bash
# Copia completa
pg_dump "$DATABASE_URL" --no-owner --no-privileges -Fc -f citaciones_$(date +%F).dump

# Sólo lo imprescindible, en texto y legible
pg_dump "$DATABASE_URL" --no-owner --data-only \
  -t public.stations -t public.batches -t public.issuances \
  -f registros_$(date +%F).sql
```

Guárdelas cifradas y fuera del servidor. **No** las suba al repositorio: contienen
tokens de consulta.

Comprobación rápida de los contadores:

```sql
select s.code, s.last_sequence, max(i.sequence) as maximo_emitido
  from public.stations s
  left join public.issuances i on i.station_code = s.code
 group by s.code, s.last_sequence
 order by s.code;
```

`last_sequence` debe ser **mayor o igual** que `maximo_emitido` en todas.

### Recuperación

```bash
pg_restore --no-owner --no-privileges -d "$DATABASE_URL" citaciones_2026-01-01.dump
```

Después de restaurar, **antes de volver a emitir**, ponga cada contador por
encima del mayor consecutivo ya emitido. Así una copia algo antigua nunca
reutiliza un número que llegó a imprimirse:

```sql
update public.stations s
   set last_sequence = greatest(
         s.last_sequence,
         coalesce((select max(i.sequence) from public.issuances i
                    where i.station_code = s.code), 0)
       );
```

Si sospecha que se imprimieron citaciones posteriores a la copia, adelante el
contador por encima del mayor número impreso conocido. Es preferible saltarse
números a repetirlos.

## Estructura

```
src/domain/      Comisarías y formato del código de registro
src/lib/         PDF, Word, QR, cliente de Supabase y API
src/features/    Sesión, emisión por bloques y exportación
src/pages/       Acceder, Generar, Historial y Consulta pública
supabase/        Migraciones
tests/           Pruebas
scripts/         Utilidades de verificación
docs/            Especificación
```

## Seguridad

- Ninguna clave privilegiada en el navegador ni en el repositorio. La clave
  `anon` es pública por diseño y sólo puede hacer lo que permiten RLS y los
  `GRANT`.
- `anon` únicamente puede ejecutar `verify_issuance()`.
- Nadie puede insertar emisiones ni modificar contadores por SQL directo: el
  único camino es `issue_batch()`.
- No se registran datos personales, porque no se recogen.

## Plantilla original

`Citacion_Policial_Formato.docx` **no se modifica nunca**. El PDF reproduce su
diseño a partir de medidas tomadas sobre ella, y el Word reutiliza su propio
paquete OOXML. Ver `docs/especificacion.md`, apartados «Fidelidad del PDF» y
«Fidelidad del Word».
