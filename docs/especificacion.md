# Especificación — Citaciones policiales

Estado: implementado. Este documento sustituye la versión anterior.

> **Cambio de alcance respecto a la primera versión.** La aplicación **no** rellena
> digitalmente la citación ni guarda datos de la persona citada. Emite el formato
> **en blanco** y le añade **únicamente** dos cosas: un código de registro y un
> código QR. Todo lo demás se escribe a mano después de imprimir.

## 1. Objetivo

Una sola persona administrativa gestiona todas las comisarías. Puede:

1. Iniciar sesión.
2. Elegir una comisaría y una cantidad.
3. Generar el lote: el servidor registra la emisión y asigna los consecutivos.
4. Descargar un único archivo **PDF** o **Word** con una citación por página.
5. Volver a descargar un lote anterior, en cualquiera de los dos formatos, sin
   crear registros nuevos.
6. Descargar el QR suelto en PNG.
7. Consultar el historial y anular emisiones.

Cualquier persona, sin cuenta, puede escanear el QR y consultar la emisión.

## 2. Qué se imprime y qué no

| En el papel | Origen |
|---|---|
| Encabezado institucional, título, etiquetas y líneas de escritura | Plantilla original, sin cambios |
| Código de registro | **Lo añade la aplicación**, en la línea que la plantilla reserva |
| Código QR | **Lo añade la aplicación**, en el recuadro de 1,45″ que la plantilla reserva |

Quedan **vacíos**, para rellenar a mano: nombre del citado, documento de
identidad (DIP), domicilio, fecha y hora de comparecencia, lugar, motivo,
Policial No., firma y sello.

**No** se imprime la comisaría ni la fecha de emisión: esos datos se consultan
mediante el QR.

### Texto del sello

La plantilla trae, bajo el código de registro, la frase «VERIFICADO EN SISTEMA».
Esa frase afirma una comprobación que en ese momento **no se ha hecho**: el papel
sale en blanco y nadie ha verificado nada de lo que se escribirá después.

Se conserva la línea, su posición, su tamaño (8 pt), su cursiva y su color
(#555555), pero con un texto que sí es cierto al imprimir:

- Emisión registrada → `REGISTRADO EN SISTEMA`
- Emisión anulada → `EMISIÓN ANULADA`

Sólo se genera un PDF o un Word a partir de registros que el servidor ya ha
guardado, de modo que la frase nunca aparece sobre un borrador ni sobre una
emisión fallida.

## 3. Código de registro

Formato: `AAAA-COMISARÍA-NNNNNNN` — por ejemplo `2026-SMII-0000001`.

- Un contador **independiente por comisaría**.
- El contador **nunca se reinicia**, tampoco al cambiar de año. Después de
  `2026-SMII-0000123` puede venir `2027-SMII-0000124`.
- El año es el de la emisión en **Africa/Malabo**.
- Mínimo siete dígitos, **sin truncar** números mayores: el consecutivo
  `10000000` se escribe entero.
- Asignación transaccional en el servidor, con restricciones de unicidad en base
  de datos e idempotencia.
- Los números de emisiones anuladas **no se reutilizan**.
- El navegador nunca calcula el consecutivo, ni lo guarda en `localStorage`.

> **Detalle de implementación.** `lpad()` de PostgreSQL *trunca* cuando la cadena
> ya es más larga que el ancho pedido: `lpad('10000000', 7, '0')` devuelve
> `'1000000'`. Por eso el relleno se hace con
> `public.format_registration_code()`, y hay una prueba que lo cubre.

## 4. Comisarías

Los códigos son identificadores estables: una vez emitida la primera citación con
uno, no puede cambiarse, porque forma parte de códigos ya impresos.

| Código | Comisaría |
|---|---|
| `SMII` | Comisaria de Santamaria II |
| `BN` | Comisaria Bioko Norte |
| `SEM` | Comisaria de Semu |
| `BAN` | Comisaria de Banapa |
| `KM5` | Comisaria de Kilometro 5 |

Fuente única: `src/domain/stations.ts` y `supabase/migrations/0002_seed_stations.sql`.

## 5. Generación por lotes

- Una citación **por página**, en PDF y en Word.
- Cada página lleva su propio código de registro y su propio QR.
- PDF y Word de un mismo lote contienen **exactamente** los mismos registros y
  los mismos QR, porque ambos se generan a partir de las filas guardadas.
- Cambiar de formato o repetir una descarga **nunca** emite registros nuevos.
- El lote queda en el historial con comisaría, cantidad, intervalo de registros y
  fecha de emisión.

Ejemplo: 50 citaciones de Santamaria II con último consecutivo 123 → se asignan
del 124 al 173, ambos incluidos.

### Límite técnico por operación

`public.max_batch_quantity()` limita cada llamada a **500** citaciones, por
memoria y por tiempo de respuesta del servicio.

Esto **no** limita a la persona usuaria: la interfaz divide una petición mayor en
bloques consecutivos y muestra el avance («bloque 2 de 4»). Como el contador de
la comisaría es continuo, los intervalos resultantes siguen siendo contiguos.

No se promete una cantidad ilimitada en una sola operación: los lotes grandes se
procesan por bloques, precisamente porque la memoria del navegador y los tiempos
del servicio son finitos.

## 6. Integridad

- **Transaccional.** `issue_batch()` hace
  `UPDATE stations SET last_sequence = last_sequence + N ... RETURNING`, que
  bloquea la fila de la comisaría hasta el *commit*. Dos lotes simultáneos
  obtienen intervalos disjuntos y contiguos.
- **Idempotente.** Cada intento lleva una clave; cada bloque deriva la suya
  (`clave#0`, `clave#1`, …). Repetir la llamada devuelve el **mismo** lote. Un
  doble clic, una reconexión o un fallo a mitad de camino no consumen números.
- **Fecha y hora del servidor**, guardadas en UTC y mostradas en Africa/Malabo.
- **Un fallo al exportar no afecta a los registros**: ya están guardados y la
  descarga se puede reintentar.

## 7. Consulta pública del QR

Cada QR identifica **una emisión concreta**, no una comisaría. Codifica:

```
<base>/#/verificar/<token>
```

El token son 16 bytes aleatorios en hexadecimal, independientes del consecutivo y
no predecibles. La base es configurable (`VITE_VERIFY_BASE_URL`) para que los QR
impresos sigan siendo válidos si cambia el dominio.

La página consulta la base de datos mediante `verify_issuance(token)` y muestra
comisaría emisora, código de registro, fecha y hora de emisión en Africa/Malabo y
estado. **No** se lee nada de los parámetros de la URL.

Se distinguen cuatro situaciones:

| Situación | Mensaje |
|---|---|
| Emisión registrada | El sistema emitió este formato |
| Emisión anulada | El registro existe pero fue anulado y no debe utilizarse |
| Registro inexistente | No hay ninguna emisión con ese código de consulta |
| Servicio no disponible | No se ha podido comprobar **ahora**; no significa que sea falso |

Un fallo de red **nunca** se presenta como documento falso o inexistente.

### Alcance de la verificación

La consulta confirma que el sistema emitió ese formato y a qué comisaría
corresponde. **No** acredita los datos escritos a mano, ni la firma, ni el sello,
ni impide que alguien copie o fotografíe un QR. La aplicación lo dice en el papel
(bajo el QR), en la página de consulta y en el pie de la interfaz.

## 8. Datos que se guardan

Sólo lo necesario para gestionar emisiones. **Ningún** dato de la persona citada
ni del contenido escrito a mano.

`batches`: identificador, comisaría, cantidad, intervalo de consecutivos, año,
fecha de creación, usuario, clave de idempotencia.

`issuances`: identificador, lote, comisaría, consecutivo, año, código de
registro, token de consulta, fecha y hora de emisión, usuario emisor, estado y,
si se anula, fecha, usuario y motivo.

## 9. Acceso

- Una persona administrativa tiene acceso a todas las comisarías.
- **No hay registro público de usuarios.** Las cuentas se crean desde el panel de
  Supabase y se autorizan poniendo `profiles.is_admin = true`.
- La autorización real está en el servidor: `is_admin()`, las políticas RLS y los
  `GRANT` de cada función. Las comprobaciones del navegador sólo evitan mostrar
  botones que fallarían.
- `anon` sólo puede ejecutar `verify_issuance()`. No puede leer ninguna tabla, ni
  el contador de las comisarías, ni listar emisiones.
- Nadie puede insertar emisiones ni tocar contadores por SQL directo: no existen
  políticas de `insert`/`update`/`delete`, así que RLS las deniega todas. El
  único camino es `issue_batch()`.

## 10. Arquitectura

- **TypeScript estricto**, React 19, Vite 8.
- **Supabase**: autenticación y PostgreSQL con RLS.
- **GitHub Pages** para la interfaz estática.
- **pdf-lib** para el PDF, **qrcode** para los QR, **fflate** para el paquete Word.
- Enrutado **por hash** (`HashRouter`): GitHub Pages sirve bajo una subruta y no
  reescribe rutas profundas a `index.html`; con el hash el QR impreso nunca da 404.
- Ninguna clave privilegiada en el navegador ni en el repositorio. La clave
  anónima de Supabase es pública por diseño y sólo puede hacer lo que permiten
  RLS y los `GRANT`.

### Fidelidad del PDF

El PDF se construye con pdf-lib reproduciendo la plantilla, no convirtiendo el
DOCX. El archivo original **nunca se modifica**.

Las posiciones de `src/lib/pdfLayout.ts` se **midieron** sobre
`Citacion_Policial_Formato.docx` renderizado a 300 ppp. Detalles que importan:

- Página A4, márgenes de 2 cm (1134 twips), recuadro de página `w:pgBorders` de
  1,5 pt a 24,9 pt por fuera del área de texto.
- Tipografía Times New Roman 11 pt (`w:docDefaults`), que en PDF es la Times
  estándar: mismas métricas, sin incrustar fuentes.
- El escudo y el QR son imágenes **flotantes** (`<wp:anchor>` con `<wp:wrapNone/>`),
  así que **no ocupan espacio vertical**; se sitúan por su desplazamiento en EMU.
  Tratarlas como imágenes en línea desplazaba todo el documento.

`tests/plantilla.test.ts` vuelve a medir el PDF generado y comprueba que cae
sobre esas mismas coordenadas, de modo que una regresión de maquetación se
detecta sola.

Reproducir la medición de referencia:

```bash
docker run --rm -v "$PWD:/data" --entrypoint /bin/bash linuxserver/libreoffice:latest \
  -c "cd /data && soffice --headless --convert-to pdf Citacion_Policial_Formato.docx --outdir /data"
pdftotext -bbox Citacion_Policial_Formato.pdf -   # posiciones del texto
pdftoppm -png -r 300 -gray Citacion_Policial_Formato.pdf ref   # filetes y QR
```

### Fidelidad del Word

El `.docx` **reutiliza el paquete OOXML original**: `src/lib/docxTemplate.ts`
contiene la plantilla sin sus imágenes, y la generación repite el cuerpo de
`document.xml` una vez por citación, sustituyendo el código de registro e
inyectando el QR. El diseño es literalmente el de la plantilla.

- Salto de página: `<w:pageBreakBefore/>` en el primer párrafo de cada copia
  (salvo la primera). No se añaden párrafos vacíos, que desplazarían el contenido.
- El QR conserva el `wp:extent` original (1329266 EMU = 1,45″), de modo que el
  tamaño impreso no se mueve.
- Cada dibujo recibe un `wp:docPr id` único.

Se recomienda el **PDF** para imprimir, porque fija el diseño; el Word se ofrece
igualmente y se verifica convirtiéndolo con LibreOffice
(`npm run docx:check`).

## 11. Pruebas

`npm test` ejecuta 101 pruebas. Las de base de datos aplican las **migraciones
reales** sobre un PostgreSQL desechable, con un sustituto mínimo del esquema
`auth` de Supabase. Todos los datos son ficticios.

Cubren: contadores independientes, continuidad al cambiar de año, sin truncar
números largos, lotes e intervalos contiguos, 20 emisiones concurrentes sin
duplicados ni solapes, idempotencia (incluida la carrera con la misma clave),
restricción de operaciones administrativas, consulta pública limitada a los
cuatro campos, los cuatro estados de consulta incluido el fallo de red, número de
páginas igual a la cantidad, registros y QR únicos por página, correspondencia
entre PDF y Word, lectura del QR extraído del PDF rasterizado, conservación del
diseño y campos manuales vacíos.

## 12. Límites conocidos

- La consulta acredita la **emisión**, no el contenido manuscrito.
- Un QR puede fotografiarse o copiarse; verlo válido no prueba que el papel sea
  el original.
- El límite de 500 citaciones por operación es del servidor; cantidades mayores
  se emiten por bloques.
- Los lotes muy grandes consumen memoria en el navegador al exportar; el avance
  se muestra y el proceso cede el turno al bucle de eventos, pero un lote de
  varios miles de páginas conviene descargarlo por partes.
