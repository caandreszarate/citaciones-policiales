import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { STATIONS, isTestStation, stationName } from '../domain/stations.ts';
import { formatMalaboDateTime } from '../domain/registration.ts';
import { MAX_BATCH_QUANTITY, listStations, type Batch, type StationRow } from '../lib/api.ts';
import {
  exportFileName,
  issueCitations,
  loadBatchPages,
  newIdempotencyKey,
  planBlocks,
  type IssueProgress,
} from '../features/issuing.ts';
import { exportCitations, downloadQrPng, type ExportFormat } from '../features/exporting.ts';
import type { CitationPdfInput } from '../lib/citationPdf.ts';

/**
 * Emision de formatos EN BLANCO.
 *
 * No hay ningun campo de la citacion aqui: nombre, DIP, domicilio, comparecencia,
 * motivo, numero policial y firma se rellenan a mano despues de imprimir.
 */

interface EmisionActual {
  readonly batches: Batch[];
  readonly stationCode: string;
  readonly stationName: string;
  readonly quantity: number;
  readonly firstCode: string;
  readonly lastCode: string;
  readonly createdAt: string;
  readonly pages: CitationPdfInput[];
}

/** Catalogo por defecto mientras responde el servidor. */
const CATALOGO_INICIAL: StationRow[] = STATIONS.map((s) => ({
  code: s.code,
  name: s.name,
  isActive: true,
}));

export function GenerarPage() {
  const [stationCode, setStationCode] = useState<string>(STATIONS[0]!.code);
  const [comisarias, setComisarias] = useState<{ clave: number; lista: StationRow[] }>({
    clave: 0,
    lista: CATALOGO_INICIAL,
  });
  const [quantity, setQuantity] = useState('1');
  const [emitiendo, setEmitiendo] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [porcentaje, setPorcentaje] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actual, setActual] = useState<EmisionActual | null>(null);
  const [exportando, setExportando] = useState<ExportFormat | null>(null);
  /**
   * Refleja en el estado si hay un intento a medias, para poder decirlo en la
   * pantalla: durante el render no se puede leer una ref.
   */
  const [intentoPendiente, setIntentoPendiente] = useState(false);

  /**
   * Clave de idempotencia del intento en curso. Se conserva mientras el intento
   * no termine bien, de modo que reintentar tras un fallo recupera los MISMOS
   * lotes en vez de emitir otros nuevos.
   */
  const claveIntento = useRef<string | null>(null);

  // El catalogo lo manda el servidor: asi una comisaria retirada desaparece del
  // selector sin necesidad de desplegar.
  useEffect(() => {
    let activo = true;
    listStations()
      .then((lista) => {
        if (activo && lista.length > 0) setComisarias({ clave: 1, lista });
      })
      .catch(() => {
        // Si falla, se sigue con la lista del codigo: no es motivo para bloquear.
      });
    return () => {
      activo = false;
    };
  }, []);

  const cantidad = Number.parseInt(quantity, 10);
  const cantidadValida = Number.isInteger(cantidad) && cantidad >= 1;
  const bloques = cantidadValida ? planBlocks(cantidad) : [];

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (emitiendo || !cantidadValida) return;

      setEmitiendo(true);
      setError(null);
      setProgreso('Solicitando los consecutivos al servidor...');
      setPorcentaje(null);

      claveIntento.current ??= newIdempotencyKey();
      setIntentoPendiente(true);

      try {
        const resultado = await issueCitations(
          { stationCode, quantity: cantidad, idempotencyKey: claveIntento.current },
          (p: IssueProgress) => {
            setProgreso(
              p.blocks > 1
                ? `Emitiendo bloque ${p.block} de ${p.blocks} (${p.issued} de ${p.total})...`
                : 'Registrando la emision...',
            );
            setPorcentaje(Math.round((p.issued / p.total) * 100));
          },
        );

        setProgreso('Recuperando los registros guardados...');
        const pages = await loadBatchPages(resultado.batches.map((b) => b.id));

        const primero = resultado.batches[0]!;
        setActual({
          batches: resultado.batches,
          stationCode: primero.stationCode,
          stationName: primero.stationName,
          quantity: pages.length,
          firstCode: pages[0]!.registrationCode,
          lastCode: pages[pages.length - 1]!.registrationCode,
          createdAt: primero.createdAt,
          pages,
        });
        // El intento acabo bien: el siguiente sera una emision distinta.
        claveIntento.current = null;
        setIntentoPendiente(false);
        setProgreso(null);
        setPorcentaje(null);
      } catch (cause) {
        // Se conserva claveIntento para que "Reintentar" no consuma numeros nuevos.
        setError(cause instanceof Error ? cause.message : 'No se pudo completar la emision.');
        setProgreso(null);
        setPorcentaje(null);
      } finally {
        setEmitiendo(false);
      }
    },
    [cantidad, cantidadValida, emitiendo, stationCode],
  );

  const descargar = useCallback(
    async (format: ExportFormat) => {
      if (!actual || exportando) return;
      setExportando(format);
      setError(null);
      setPorcentaje(0);
      try {
        await exportCitations(
          actual.pages,
          format,
          exportFileName(actual.stationCode, actual.firstCode, actual.lastCode, format),
          (done, total) => {
            setProgreso(`Preparando ${format === 'pdf' ? 'el PDF' : 'el Word'}: ${done} de ${total}`);
            setPorcentaje(Math.round((done / total) * 100));
          },
        );
        setProgreso(null);
      } catch (cause) {
        // Un fallo al exportar NO afecta a los registros: ya estan guardados.
        setError(
          `No se pudo generar el archivo: ${
            cause instanceof Error ? cause.message : 'error desconocido'
          }. Los registros ya estan emitidos; puede volver a intentar la descarga sin crear otros.`,
        );
      } finally {
        setExportando(null);
        setPorcentaje(null);
      }
    },
    [actual, exportando],
  );

  return (
    <>
      <section className="tarjeta">
        <h2>Generar citaciones en blanco</h2>
        <p className="ayuda">
          La aplicacion imprime el formato vacio y le anade unicamente el codigo de registro y
          su codigo QR. El resto de los campos se rellenan a mano.
        </p>

        <form onSubmit={onSubmit} noValidate>
          <div className="fila">
            <div className="campo">
              <label htmlFor="comisaria">Comisaria</label>
              <select
                id="comisaria"
                value={stationCode}
                onChange={(e) => setStationCode(e.target.value)}
                disabled={emitiendo}
              >
                {comisarias.lista.map((s) => (
                  <option key={s.code} value={s.code}>
                    {isTestStation(s.code) ? '⚠ ' : ''}
                    {stationName(s.code, s.name)} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="campo">
              <label htmlFor="cantidad">Cantidad</label>
              <input
                id="cantidad"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={emitiendo}
                aria-describedby="ayuda-cantidad"
                aria-invalid={quantity !== '' && !cantidadValida}
              />
              <p className="ayuda" id="ayuda-cantidad">
                {bloques.length > 1
                  ? `Se emitira en ${bloques.length} bloques de hasta ${MAX_BATCH_QUANTITY}, con consecutivos contiguos.`
                  : `Una pagina por citacion. Maximo ${MAX_BATCH_QUANTITY} por operacion; por encima se divide en bloques.`}
              </p>
            </div>
          </div>

          {isTestStation(stationCode) ? (
            <div className="aviso atencion">
              <p>
                <strong>Comisaria de pruebas.</strong> Las citaciones que emita aqui NO son
                validas. Sirven para comprobar el sistema sin gastar consecutivos de las
                comisarias reales.
              </p>
            </div>
          ) : null}

          <div className="acciones">
            <button type="submit" disabled={emitiendo || !cantidadValida}>
              {emitiendo ? 'Generando...' : 'Generar citaciones'}
            </button>
          </div>
        </form>

        {(progreso ?? porcentaje !== null) ? (
          <div aria-live="polite">
            {porcentaje !== null ? <progress max={100} value={porcentaje} /> : null}
            {progreso ? <p className="progreso-texto">{progreso}</p> : null}
          </div>
        ) : null}

        {error ? (
          <div className="aviso error" role="alert">
            <p>{error}</p>
            {intentoPendiente ? (
              <p>
                Puede pulsar <strong>Generar citaciones</strong> de nuevo: se recuperara la misma
                emision sin consumir consecutivos nuevos.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {actual ? (
        <section className="tarjeta" aria-live="polite">
          <h2>Emision registrada</h2>

          <dl className="rejilla-datos">
            <dt>Comisaria</dt>
            <dd>
              {actual.stationName} ({actual.stationCode})
            </dd>
            <dt>Cantidad</dt>
            <dd>{actual.quantity}</dd>
            <dt>Intervalo de registros</dt>
            <dd className="monoespaciado">
              {actual.firstCode === actual.lastCode
                ? actual.firstCode
                : `${actual.firstCode} — ${actual.lastCode}`}
            </dd>
            <dt>Fecha de emision</dt>
            <dd>{formatMalaboDateTime(actual.createdAt)}</dd>
          </dl>

          <div className="acciones" style={{ marginTop: '1.25rem' }}>
            <button type="button" onClick={() => void descargar('pdf')} disabled={exportando !== null}>
              {exportando === 'pdf' ? 'Preparando PDF...' : 'Descargar PDF'}
            </button>
            <button
              type="button"
              className="secundario"
              onClick={() => void descargar('docx')}
              disabled={exportando !== null}
            >
              {exportando === 'docx' ? 'Preparando Word...' : 'Descargar Word (.docx)'}
            </button>
            {actual.pages.length === 1 ? (
              <button
                type="button"
                className="secundario"
                onClick={() =>
                  void downloadQrPng(actual.pages[0]!.verificationUrl, actual.firstCode)
                }
              >
                Descargar QR (PNG)
              </button>
            ) : null}
          </div>

          <p className="ayuda" style={{ marginTop: '0.9rem' }}>
            El PDF conserva el diseño de impresion con mayor fidelidad. Volver a descargar, en
            cualquiera de los dos formatos, reutiliza estos mismos registros: no se emite ninguno
            nuevo. El lote queda guardado en el historial.
          </p>
        </section>
      ) : null}
    </>
  );
}
