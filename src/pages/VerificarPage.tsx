import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { verifyIssuance, type VerificationResult } from '../lib/api.ts';
import { formatMalaboDateTime } from '../domain/registration.ts';

/**
 * Consulta publica. Es lo que abre el QR impreso.
 *
 * Distingue con claridad los cuatro casos. Un fallo de red NO es un documento
 * falso, y la pagina lo dice expresamente.
 */
export function VerificarPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [intento, setIntento] = useState(0);
  // El resultado se guarda junto a la consulta que lo produjo, de modo que
  // "esta cargando" se deduce en el render en lugar de escribirse en el efecto.
  const [respuesta, setRespuesta] = useState<{
    clave: string;
    resultado: VerificationResult;
  } | null>(null);

  const clave = `${token}#${intento}`;

  useEffect(() => {
    let activo = true;
    void verifyIssuance(token).then((resultado) => {
      if (activo) setRespuesta({ clave, resultado });
    });
    return () => {
      activo = false;
    };
  }, [token, clave]);

  const cargando = respuesta?.clave !== clave;
  const estado = cargando ? null : respuesta.resultado;

  return (
    <section className="tarjeta">
      <h2>Consulta de emision</h2>

      <div aria-live="polite">
        {cargando ? <p>Consultando el registro...</p> : null}

        {!cargando && estado?.kind === 'registrada' ? (
          <>
            <div className="aviso exito">
              <p>
                <strong>Emision registrada.</strong> Este formato fue emitido por el sistema.
              </p>
            </div>
            <DatosEmision datos={estado.data} />
          </>
        ) : null}

        {!cargando && estado?.kind === 'anulada' ? (
          <>
            <div className="aviso error">
              <p>
                <strong>Emision anulada.</strong> El registro existe, pero fue anulado y no debe
                utilizarse.
              </p>
            </div>
            <DatosEmision datos={estado.data} />
          </>
        ) : null}

        {!cargando && estado?.kind === 'inexistente' ? (
          <div className="aviso atencion">
            <p>
              <strong>Registro inexistente.</strong> No hay ninguna emision con este codigo de
              consulta.
            </p>
            <p>
              Compruebe que ha escaneado el QR completo. Si el codigo es correcto, el documento no
              procede de este sistema.
            </p>
          </div>
        ) : null}

        {!cargando && estado?.kind === 'no-disponible' ? (
          <div className="aviso neutro" role="alert">
            <p>
              <strong>Servicio no disponible.</strong> No se ha podido consultar el registro.
            </p>
            <p>
              Esto <strong>no</strong> significa que el documento sea falso ni que no exista:
              unicamente que ahora mismo no se puede comprobar. Intentelo de nuevo mas tarde.
            </p>
            <p className="ayuda">Detalle tecnico: {estado.detail}</p>
            <div className="acciones" style={{ marginTop: '0.75rem' }}>
              <button type="button" onClick={() => setIntento((n) => n + 1)}>
                Reintentar
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <h3 style={{ fontSize: '0.95rem', marginBottom: '0.35rem' }}>Alcance de esta consulta</h3>
      <p className="ayuda">
        Confirma que el sistema emitio este formato y a que comisaria corresponde. No acredita los
        datos escritos a mano, ni la firma, ni el sello, ni impide que alguien copie o fotografie
        un codigo QR.
      </p>
    </section>
  );
}

function DatosEmision({
  datos,
}: {
  datos: { registrationCode: string; stationName: string; stationCode: string; issuedAt: string; status: string };
}) {
  return (
    <dl className="rejilla-datos">
      <dt>Codigo de registro</dt>
      <dd className="monoespaciado">{datos.registrationCode}</dd>
      <dt>Comisaria emisora</dt>
      <dd>
        {datos.stationName} ({datos.stationCode})
      </dd>
      <dt>Fecha y hora de emision</dt>
      <dd>
        {formatMalaboDateTime(datos.issuedAt)}{' '}
        <span className="ayuda" style={{ fontWeight: 400 }}>
          (hora de Malabo)
        </span>
      </dd>
      <dt>Estado</dt>
      <dd>
        <span className={`etiqueta ${datos.status}`}>{datos.status}</span>
      </dd>
    </dl>
  );
}
