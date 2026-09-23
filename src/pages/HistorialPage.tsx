import { useCallback, useEffect, useState } from 'react';
import { STATIONS, stationName } from '../domain/stations.ts';
import { formatMalaboDateTime } from '../domain/registration.ts';
import {
  annulBatch,
  annulCitation,
  listBatches,
  listIssuances,
  type BatchSummary,
  type HistoryEntry,
  type IssuanceStatus,
} from '../lib/api.ts';
import { exportFileName, loadBatchPages, toPage } from '../features/issuing.ts';
import { exportCitations, downloadQrPng, type ExportFormat } from '../features/exporting.ts';
import { formatRegistrationCode } from '../domain/registration.ts';

/**
 * Historial privado: localizar emisiones, volver a descargarlas y anularlas.
 *
 * Todas las descargas parten de los registros guardados, de modo que ninguna
 * crea emisiones nuevas.
 */
export function HistorialPage() {
  const [vista, setVista] = useState<'lotes' | 'citaciones'>('lotes');

  return (
    <>
      <section className="tarjeta">
        <h2>Historial</h2>
        <p className="ayuda">
          Descargar de nuevo un lote o una citacion no emite ningun registro nuevo: se reutilizan
          los consecutivos y los QR ya guardados.
        </p>
        <div className="acciones">
          <button
            type="button"
            className={vista === 'lotes' ? '' : 'secundario'}
            onClick={() => setVista('lotes')}
            aria-pressed={vista === 'lotes'}
          >
            Lotes
          </button>
          <button
            type="button"
            className={vista === 'citaciones' ? '' : 'secundario'}
            onClick={() => setVista('citaciones')}
            aria-pressed={vista === 'citaciones'}
          >
            Citaciones
          </button>
        </div>
      </section>

      {vista === 'lotes' ? <Lotes /> : <Citaciones />}
    </>
  );
}

// ------------------------------------------------------------------------ lotes

function Lotes() {
  const [stationCode, setStationCode] = useState('');
  const [recarga, setRecarga] = useState(0);
  const [respuesta, setRespuesta] = useState<{ clave: string; lotes: BatchSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<string | null>(null);

  const clave = `${stationCode}#${recarga}`;
  const recargar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    let activo = true;
    listBatches({ stationCode: stationCode || undefined })
      .then((datos) => {
        if (activo) setRespuesta({ clave, lotes: datos });
      })
      .catch((cause: unknown) => {
        if (activo) {
          setRespuesta({ clave, lotes: [] });
          setError(cause instanceof Error ? cause.message : 'No se pudo cargar el historial.');
        }
      });
    return () => {
      activo = false;
    };
  }, [stationCode, clave]);

  const cargando = respuesta?.clave !== clave;
  const lotes = cargando ? [] : respuesta.lotes;

  const descargar = useCallback(
    async (lote: BatchSummary, format: ExportFormat) => {
      setOcupado(lote.id);
      setError(null);
      try {
        setProgreso('Recuperando los registros guardados...');
        const pages = await loadBatchPages([lote.id]);
        await exportCitations(
          pages,
          format,
          exportFileName(
            lote.stationCode,
            pages[0]!.registrationCode,
            pages[pages.length - 1]!.registrationCode,
            format,
          ),
          (done, total) => setProgreso(`Preparando el archivo: ${done} de ${total}`),
        );
        setProgreso(null);
      } catch (cause) {
        setError(
          `No se pudo generar el archivo: ${
            cause instanceof Error ? cause.message : 'error desconocido'
          }. Los registros siguen guardados; puede reintentar la descarga.`,
        );
      } finally {
        setOcupado(null);
        setProgreso(null);
      }
    },
    [],
  );

  const anular = useCallback(
    async (lote: BatchSummary) => {
      const motivo = window.prompt(
        `Va a anular las ${lote.quantity} citaciones del lote ${lote.stationCode} ` +
          `${lote.firstSequence}–${lote.lastSequence}.\n\n` +
          'Los registros se conservan y sus numeros no se reutilizan.\n\n' +
          'Escriba el motivo para confirmar:',
      );
      if (motivo === null || motivo.trim() === '') return;

      setOcupado(lote.id);
      try {
        const n = await annulBatch(lote.id, motivo.trim());
        setProgreso(`Se anularon ${n} citaciones.`);
        recargar();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudo anular el lote.');
      } finally {
        setOcupado(null);
      }
    },
    [recargar],
  );

  return (
    <section className="tarjeta">
      <div className="campo" style={{ maxWidth: '22rem' }}>
        <label htmlFor="filtro-comisaria-lote">Comisaria</label>
        <select
          id="filtro-comisaria-lote"
          value={stationCode}
          onChange={(e) => setStationCode(e.target.value)}
        >
          <option value="">Todas</option>
          {STATIONS.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="aviso error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}
      {progreso ? (
        <p className="progreso-texto" aria-live="polite">
          {progreso}
        </p>
      ) : null}

      {cargando ? <p>Cargando lotes...</p> : null}
      {!cargando && lotes.length === 0 ? <p>No hay lotes que mostrar.</p> : null}

      {lotes.length > 0 ? (
        <div className="tabla-envoltorio">
          <table>
            <caption className="visualmente-oculto">Lotes emitidos</caption>
            <thead>
              <tr>
                <th scope="col">Comisaria</th>
                <th scope="col">Cantidad</th>
                <th scope="col">Intervalo de registros</th>
                <th scope="col">Fecha de emision</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lotes.map((lote) => (
                <tr key={lote.id}>
                  <td>{stationName(lote.stationCode)}</td>
                  <td>{lote.quantity}</td>
                  <td className="monoespaciado">
                    {formatRegistrationCode(lote.year, lote.stationCode, lote.firstSequence)}
                    {lote.quantity > 1
                      ? ` — ${formatRegistrationCode(lote.year, lote.stationCode, lote.lastSequence)}`
                      : ''}
                  </td>
                  <td>{formatMalaboDateTime(lote.createdAt)}</td>
                  <td>
                    <div className="acciones">
                      <button
                        type="button"
                        className="secundario"
                        disabled={ocupado !== null}
                        onClick={() => void descargar(lote, 'pdf')}
                      >
                        PDF
                      </button>
                      <button
                        type="button"
                        className="secundario"
                        disabled={ocupado !== null}
                        onClick={() => void descargar(lote, 'docx')}
                      >
                        Word
                      </button>
                      <button
                        type="button"
                        className="secundario peligro"
                        disabled={ocupado !== null}
                        onClick={() => void anular(lote)}
                      >
                        Anular
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------- citaciones

function Citaciones() {
  const [stationCode, setStationCode] = useState('');
  const [status, setStatus] = useState<'' | IssuanceStatus>('');
  const [search, setSearch] = useState('');
  const [recarga, setRecarga] = useState(0);
  const [respuesta, setRespuesta] = useState<{ clave: string; entradas: HistoryEntry[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const clave = `${stationCode}|${status}|${search}#${recarga}`;
  const recargar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    let activo = true;
    listIssuances({
      stationCode: stationCode || undefined,
      status: status || undefined,
      search: search || undefined,
    })
      .then((datos) => {
        if (activo) setRespuesta({ clave, entradas: datos });
      })
      .catch((cause: unknown) => {
        if (activo) {
          setRespuesta({ clave, entradas: [] });
          setError(cause instanceof Error ? cause.message : 'No se pudo cargar el historial.');
        }
      });
    return () => {
      activo = false;
    };
  }, [stationCode, status, search, clave]);

  const cargando = respuesta?.clave !== clave;
  const entradas = cargando ? [] : respuesta.entradas;

  const anular = useCallback(
    async (entrada: HistoryEntry) => {
      const motivo = window.prompt(
        `Va a anular la citacion ${entrada.registrationCode}.\n\n` +
          'El registro se conserva y su numero no se reutiliza.\n\n' +
          'Escriba el motivo para confirmar:',
      );
      if (motivo === null || motivo.trim() === '') return;
      setOcupado(entrada.id);
      try {
        await annulCitation(entrada.id, motivo.trim());
        recargar();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudo anular la citacion.');
      } finally {
        setOcupado(null);
      }
    },
    [recargar],
  );

  const descargar = useCallback(async (entrada: HistoryEntry, format: ExportFormat) => {
    setOcupado(entrada.id);
    setError(null);
    try {
      await exportCitations(
        [toPage(entrada)],
        format,
        exportFileName(entrada.stationCode, entrada.registrationCode, entrada.registrationCode, format),
      );
    } catch (cause) {
      setError(
        `No se pudo generar el archivo: ${
          cause instanceof Error ? cause.message : 'error desconocido'
        }. El registro sigue guardado; puede reintentar la descarga.`,
      );
    } finally {
      setOcupado(null);
    }
  }, []);

  return (
    <section className="tarjeta">
      <div className="fila">
        <div className="campo">
          <label htmlFor="filtro-comisaria">Comisaria</label>
          <select
            id="filtro-comisaria"
            value={stationCode}
            onChange={(e) => setStationCode(e.target.value)}
          >
            <option value="">Todas</option>
            {STATIONS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="filtro-estado">Estado</label>
          <select
            id="filtro-estado"
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | IssuanceStatus)}
          >
            <option value="">Todos</option>
            <option value="registrada">Registrada</option>
            <option value="anulada">Anulada</option>
          </select>
        </div>
        <div className="campo">
          <label htmlFor="filtro-codigo">Codigo de registro</label>
          <input
            id="filtro-codigo"
            type="search"
            value={search}
            placeholder="2026-SMII-0000124"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <div className="aviso error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      {cargando ? <p>Cargando citaciones...</p> : null}
      {!cargando && entradas.length === 0 ? <p>No hay citaciones que mostrar.</p> : null}

      {entradas.length > 0 ? (
        <div className="tabla-envoltorio">
          <table>
            <caption className="visualmente-oculto">Citaciones emitidas</caption>
            <thead>
              <tr>
                <th scope="col">Codigo de registro</th>
                <th scope="col">Comisaria</th>
                <th scope="col">Emision</th>
                <th scope="col">Estado</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {entradas.map((entrada) => (
                <tr key={entrada.id}>
                  <td className="monoespaciado">{entrada.registrationCode}</td>
                  <td>{stationName(entrada.stationCode)}</td>
                  <td>{formatMalaboDateTime(entrada.issuedAt)}</td>
                  <td>
                    <span className={`etiqueta ${entrada.status}`}>{entrada.status}</span>
                  </td>
                  <td>
                    <div className="acciones">
                      <button
                        type="button"
                        className="secundario"
                        disabled={ocupado !== null}
                        onClick={() => void descargar(entrada, 'pdf')}
                      >
                        PDF
                      </button>
                      <button
                        type="button"
                        className="secundario"
                        disabled={ocupado !== null}
                        onClick={() =>
                          void downloadQrPng(
                            toPage(entrada).verificationUrl,
                            entrada.registrationCode,
                          )
                        }
                      >
                        QR
                      </button>
                      {entrada.status === 'registrada' ? (
                        <button
                          type="button"
                          className="secundario peligro"
                          disabled={ocupado !== null}
                          onClick={() => void anular(entrada)}
                        >
                          Anular
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
