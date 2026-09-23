import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DOCX_TEMPLATE_BASE64 } from './docxTemplate.ts';
import { COAT_OF_ARMS_PNG_BASE64 } from './coatOfArms.ts';
import { renderQrPng, type CitationPdfInput, type ProgressCallback } from './citationPdf.ts';

/**
 * Exportacion a Word (.docx).
 *
 * En lugar de reconstruir el documento, se reutiliza el paquete OOXML ORIGINAL:
 * el cuerpo de document.xml se repite una vez por citacion, sustituyendo
 * unicamente el codigo de registro y la imagen del QR. Asi el diseno, los textos
 * institucionales y los espacios de escritura manual son literalmente los de la
 * plantilla facilitada.
 *
 * El archivo DOCX original nunca se modifica.
 */

/** Marcador del codigo de registro en la plantilla. */
const REGISTRATION_PLACEHOLDER = '<w:t>REG# — ________ — ________ — ________</w:t>';
/** Texto del sello en la plantilla. Ver docs/especificacion.md, "Texto del sello". */
const STAMP_PLACEHOLDER = '<w:t>VERIFICADO EN SISTEMA</w:t>';
/** Relacion del QR de marcador en la plantilla original (media/image2.png). */
const QR_RELATIONSHIP_ID = 'rId6';
/** Relacion del escudo (media/image1.png). */
const COAT_RELATIONSHIP_ID = 'rId5';

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/** fflate exige Uint8Array<ArrayBuffer>; normalizamos por si llega un SharedArrayBuffer. */
function toArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) return bytes as Uint8Array<ArrayBuffer>;
  return new Uint8Array(bytes);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Inserta <w:pageBreakBefore/> en el primer parrafo de una copia, para forzar
 * UNA citacion por pagina sin anadir parrafos vacios que desplacen el contenido.
 * En CT_PPr, pageBreakBefore va antes de spacing/jc, de ahi que se inserte justo
 * despues de la apertura de <w:pPr>.
 */
function forcePageBreakBefore(bodyXml: string): string {
  const paragraphStart = bodyXml.indexOf('<w:p ');
  if (paragraphStart === -1) return bodyXml;

  const paragraphEnd = bodyXml.indexOf('>', paragraphStart) + 1;
  const afterOpen = bodyXml.slice(paragraphEnd);

  if (afterOpen.startsWith('<w:pPr>')) {
    return (
      bodyXml.slice(0, paragraphEnd) +
      '<w:pPr><w:pageBreakBefore/>' +
      afterOpen.slice('<w:pPr>'.length)
    );
  }
  return bodyXml.slice(0, paragraphEnd) + '<w:pPr><w:pageBreakBefore/></w:pPr>' + afterOpen;
}

/** wp:docPr id debe ser unico en todo el documento. */
function renumberDrawingIds(bodyXml: string, index: number): string {
  let n = 0;
  return bodyXml.replace(/<wp:docPr id="\d+"/g, () => {
    n += 1;
    return `<wp:docPr id="${index * 100 + n + 1}"`;
  });
}

export interface DocxBuildResult {
  readonly bytes: Uint8Array;
  /** Numero de saltos de pagina forzados; debe ser citaciones - 1. */
  readonly pageBreaks: number;
}

export async function buildCitationsDocxDetailed(
  items: readonly CitationPdfInput[],
  onProgress?: ProgressCallback,
): Promise<DocxBuildResult> {
  if (items.length === 0) {
    throw new Error('El lote no contiene ninguna citacion.');
  }

  const files = unzipSync(decodeBase64(DOCX_TEMPLATE_BASE64));

  const documentPart = files['word/document.xml'];
  const relsPart = files['word/_rels/document.xml.rels'];
  if (!documentPart || !relsPart) {
    throw new Error('La plantilla DOCX incrustada es invalida.');
  }

  const documentXml = strFromU8(documentPart);
  const bodyOpen = documentXml.indexOf('<w:body>') + '<w:body>'.length;
  const sectionStart = documentXml.indexOf('<w:sectPr');
  if (bodyOpen < '<w:body>'.length || sectionStart === -1) {
    throw new Error('No se reconoce la estructura de la plantilla DOCX.');
  }

  const prefix = documentXml.slice(0, bodyOpen);
  const bodyTemplate = documentXml.slice(bodyOpen, sectionStart);
  const suffix = documentXml.slice(sectionStart);

  const media: Record<string, Uint8Array<ArrayBuffer>> = {
    'word/media/image1.png': decodeBase64(COAT_OF_ARMS_PNG_BASE64),
  };
  const relationships: string[] = [];
  const bodies: string[] = [];
  let pageBreaks = 0;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const qrRelId = `rIdQR${i}`;
    const qrName = `qr${i}.png`;

    media[`word/media/${qrName}`] = toArrayBufferView(await renderQrPng(item.verificationUrl));
    relationships.push(
      `<Relationship Id="${qrRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${qrName}"/>`,
    );

    let body = bodyTemplate;

    // 1. Codigo de registro: lo unico que se escribe sobre el formato, ademas del QR.
    body = body.replace(
      REGISTRATION_PLACEHOLDER,
      `<w:t>${escapeXml(item.registrationCode)}</w:t>`,
    );

    // 2. Sello: afirmacion cierta en el momento de imprimir.
    body = body.replace(
      STAMP_PLACEHOLDER,
      `<w:t>${item.status === 'anulada' ? 'EMISIÓN ANULADA' : 'REGISTRADO EN SISTEMA'}</w:t>`,
    );

    // 3. QR propio de esta citacion. El wp:extent original (1,45 x 1,45 pulgadas)
    //    se conserva intacto, de modo que el tamano impreso no se desplaza.
    body = body.replaceAll(`r:embed="${QR_RELATIONSHIP_ID}"`, `r:embed="${qrRelId}"`);

    body = renumberDrawingIds(body, i);

    // 4. Una citacion por pagina.
    if (i > 0) {
      body = forcePageBreakBefore(body);
      pageBreaks += 1;
    }

    bodies.push(body);
    onProgress?.(i + 1, items.length);
    if (i % 10 === 9) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Relaciones: se conservan las de la plantilla salvo la del QU de marcador,
  // que ya no existe, y se anade una por cada QR generado.
  const baseRels = strFromU8(relsPart)
    .replace(/<Relationship Id="rId6"[^>]*\/>/, '')
    .replace('</Relationships>', `${relationships.join('')}</Relationships>`);

  files['word/document.xml'] = strToU8(prefix + bodies.join('') + suffix);
  files['word/_rels/document.xml.rels'] = strToU8(baseRels);
  for (const [name, bytes] of Object.entries(media)) files[name] = bytes;

  return { bytes: zipSync(files, { level: 6 }), pageBreaks };
}

export async function buildCitationsDocx(
  items: readonly CitationPdfInput[],
  onProgress?: ProgressCallback,
): Promise<Uint8Array> {
  return (await buildCitationsDocxDetailed(items, onProgress)).bytes;
}

export { COAT_RELATIONSHIP_ID };
