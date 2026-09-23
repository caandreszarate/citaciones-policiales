import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { COAT_OF_ARMS_PNG_BASE64 } from './coatOfArms.ts';
import * as L from './pdfLayout.ts';

/**
 * Genera el PDF del formato de citacion EN BLANCO.
 *
 * La aplicacion anade unicamente dos cosas, y ambas caen en huecos que la
 * plantilla original ya reservaba:
 *   1. El codigo de registro, en la linea marcada "REG# — ____ — ____ — ____".
 *   2. El codigo QR, en el recuadro de 1.45 x 1.45 pulgadas del pie.
 *
 * Todos los demas campos (nombre, DIP, domicilio, fecha y hora de comparecencia,
 * lugar, motivo, Policial No., firma y sello) quedan VACIOS: se rellenan a mano
 * despues de imprimir.
 */

export interface CitationPdfInput {
  /** Codigo de registro asignado por el servidor, p. ej. 2026-SMII-0000001. */
  readonly registrationCode: string;
  /** URL de consulta publica que codifica el QR. */
  readonly verificationUrl: string;
  /** Estado de la emision segun el servidor. */
  readonly status: 'registrada' | 'anulada';
}

/** Progreso de una exportacion larga, para no dejar la interfaz muda. */
export type ProgressCallback = (done: number, total: number) => void;

const GRAY = rgb(0x55 / 255, 0x55 / 255, 0x55 / 255);
const BLACK = rgb(0, 0, 0);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

function drawCentered(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  centerX: number,
  baseline: number,
  color = BLACK,
): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: centerX - width / 2, y: baseline, size, font, color });
}

function drawRight(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  rightX: number,
  baseline: number,
  color = BLACK,
): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - width, y: baseline, size, font, color });
}

function drawRule(page: PDFPage, x1: number, x2: number, y: number, thickness: number): void {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color: BLACK });
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/** QR como PNG. Correccion de errores media: legible impreso sin agrandar el modulo. */
export async function renderQrPng(verificationUrl: string): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL(verificationUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
  return decodeBase64(dataUrl.slice(dataUrl.indexOf(',') + 1));
}

/**
 * Dibuja UNA citacion en UNA pagina. Una pagina por citacion, tanto si el lote
 * tiene una como si tiene quinientas.
 */
async function drawCitationPage(
  doc: PDFDocument,
  fonts: Fonts,
  coat: PDFImage,
  input: CitationPdfInput,
): Promise<void> {
  const page = doc.addPage([L.PAGE_WIDTH, L.PAGE_HEIGHT]);
  const centerX = L.CONTENT_LEFT + L.CONTENT_WIDTH / 2;
  const B = L.TEMPLATE.baselines;

  // Recuadro de la pagina (w:pgBorders).
  page.drawRectangle({
    x: L.CONTENT_LEFT - L.PAGE_BORDER_SPACE,
    y: L.MARGIN - L.PAGE_BORDER_SPACE,
    width: L.CONTENT_WIDTH + 2 * L.PAGE_BORDER_SPACE,
    height: L.CONTENT_TOP - L.MARGIN + 2 * L.PAGE_BORDER_SPACE,
    borderWidth: L.PAGE_BORDER_WIDTH,
    borderColor: BLACK,
  });

  // ---------------------------------------------------------------- Encabezado
  // Escudo: imagen flotante (<wp:anchor>), en su desplazamiento original.
  page.drawImage(coat, {
    x: L.CONTENT_LEFT + L.COAT_OFFSET_X,
    y: L.CONTENT_TOP - L.COAT_OFFSET_Y - L.COAT_HEIGHT,
    width: L.COAT_WIDTH,
    height: L.COAT_HEIGHT,
  });

  drawCentered(page, 'REPÚBLICA DE GUINEA ECUATORIAL', fonts.bold, 15, centerX, L.fromTop(B.republica));
  drawCentered(page, 'MINISTERIO DE SEGURIDAD NACIONAL', fonts.bold, 11, centerX, L.fromTop(B.ministerio));
  drawCentered(page, 'DIRECCIÓN GENERAL DE LA POLICÍA NACIONAL', fonts.bold, 11, centerX, L.fromTop(B.direccion));
  drawRule(page, L.CONTENT_LEFT, L.CONTENT_RIGHT, L.fromTop(L.TEMPLATE.headerRuleY), L.HEADER_RULE_WIDTH);

  drawCentered(page, 'CITACIÓN POLICIAL', fonts.bold, 16, centerX, L.fromTop(B.titulo));

  // ------------------------------------------------- Bloque del codigo de registro
  drawRight(page, 'CÓDIGO DE REGISTRO:', fonts.bold, 10, L.CONTENT_RIGHT, L.fromTop(B.codigoEtiqueta));

  // PRIMERO de los dos unicos datos que anade la aplicacion. Ocupa exactamente la
  // linea que la plantilla reserva con "REG# — ____ — ____ — ____".
  drawRight(page, input.registrationCode, fonts.regular, 10, L.CONTENT_RIGHT, L.fromTop(B.codigoValor));

  // La plantilla trae "VERIFICADO EN SISTEMA" en esta linea. Se sustituye por una
  // afirmacion que si es cierta al imprimir: el sistema ha registrado la emision,
  // pero no ha verificado nada de lo que se escriba despues a mano.
  // Ver docs/especificacion.md, "Texto del sello".
  const stampText = input.status === 'anulada' ? 'EMISIÓN ANULADA' : 'REGISTRADO EN SISTEMA';
  drawRight(page, stampText, fonts.italic, 8, L.CONTENT_RIGHT, L.fromTop(B.sello), GRAY);

  // ------------------------------------------------------- Tabla de campos manuales
  // Nueve filas. TODAS las lineas de escritura quedan vacias: nombre, DIP,
  // domicilio, comparecencia, lugar, motivo y numero policial se rellenan a mano.
  const labelX = L.fieldColumnX(0);
  const col1X = L.fieldColumnX(1);
  const col2X = L.fieldColumnX(2);
  const col3X = L.fieldColumnX(3);
  const col4X = L.fieldColumnX(4);

  const label = (index: number, text: string, font = fonts.bold, x = labelX): void => {
    page.drawText(text, {
      x,
      y: L.fieldBaselineY(index),
      size: L.BASE_FONT_SIZE,
      font,
      color: BLACK,
    });
  };
  const rule = (index: number, from: number, to: number): void => {
    drawRule(page, from, to, L.fieldRuleY(index), L.RULE_WIDTH);
  };

  label(0, 'Nombre del Citado:');
  rule(0, col1X, L.CONTENT_RIGHT);

  label(1, 'Documento de Identidad:');
  // "DIP" es texto impreso de la plantilla, no un dato: el numero se escribe a mano.
  label(1, 'DIP ', fonts.regular, col1X);
  rule(1, col1X, L.CONTENT_RIGHT);

  label(2, 'Domicilio:');
  rule(2, col1X, L.CONTENT_RIGHT);

  // Fecha y hora de COMPARECENCIA: se escriben a mano, no son la fecha de emision.
  label(3, 'Fecha de Citación:');
  rule(3, col1X, col2X);
  label(3, 'Hora:', fonts.bold, col2X);
  rule(3, col3X, col4X);
  label(3, ' horas', fonts.bold, col4X);

  label(4, 'Lugar:');
  rule(4, col1X, L.CONTENT_RIGHT);
  rule(5, col1X, L.CONTENT_RIGHT); // segunda linea de Lugar

  label(6, 'Motivo de la Citación:');
  rule(6, col1X, L.CONTENT_RIGHT);
  rule(7, col1X, L.CONTENT_RIGHT); // segunda linea de Motivo

  label(8, 'Policial No.:');
  rule(8, col1X, col2X);

  // ------------------------------------------------------------- Pie: QR y firma
  const signLeft = L.CONTENT_LEFT + L.FOOTER_COL;
  const signatureY = L.fromTop(L.TEMPLATE.signatureRuleY);
  drawRule(page, signLeft, L.CONTENT_RIGHT, signatureY, L.RULE_WIDTH);
  drawCentered(
    page,
    'Firma y sello del Agente Notificador',
    fonts.regular,
    10,
    signLeft + L.FOOTER_COL / 2,
    L.fromTop(B.firma),
  );

  // SEGUNDO de los dos unicos datos que anade la aplicacion. Cae en el hueco de
  // 1,45 x 1,45 pulgadas que la plantilla ya reservaba: no tapa ningun texto ni
  // reduce el espacio de escritura.
  const qrX = L.TEMPLATE.qrLeftX;
  const qrY = L.fromTop(L.TEMPLATE.qrTopY) - L.QR_SIZE;
  const qrImage = await doc.embedPng(await renderQrPng(input.verificationUrl));
  page.drawImage(qrImage, { x: qrX, y: qrY, width: L.QR_SIZE, height: L.QR_SIZE });

  // Alcance de la consulta, bajo el QR, en espacio que la plantilla deja libre.
  // Breve y honesto: el QR acredita la emision del formato, no lo escrito a mano.
  const qrCenter = qrX + L.QR_SIZE / 2;
  drawCentered(page, 'Escanee para consultar la emisión de este formato.', fonts.italic, 7, qrCenter, qrY - 10, GRAY);
  drawCentered(page, 'No acredita lo escrito a mano, la firma ni el sello.', fonts.italic, 7, qrCenter, qrY - 10 - L.lineHeight(7), GRAY);
}

/**
 * Construye el PDF de un lote: una pagina por citacion, en el orden de los
 * consecutivos. Se genera SIEMPRE a partir de los registros ya guardados por el
 * servidor, nunca de numeros calculados en el navegador, de modo que repetir la
 * descarga no crea ninguna emision nueva.
 *
 * `onProgress` permite mostrar avance; entre paginas se cede el turno al bucle de
 * eventos para que la interfaz siga respondiendo en lotes grandes.
 */
export async function buildCitationsPdf(
  items: readonly CitationPdfInput[],
  onProgress?: ProgressCallback,
): Promise<Uint8Array> {
  if (items.length === 0) {
    throw new Error('El lote no contiene ninguna citacion.');
  }

  const doc = await PDFDocument.create();
  const first = items[0]!;
  const last = items[items.length - 1]!;
  doc.setTitle(
    items.length === 1
      ? `Citacion policial ${first.registrationCode}`
      : `Citaciones policiales ${first.registrationCode} a ${last.registrationCode}`,
  );
  doc.setSubject('Formatos de citacion policial en blanco');
  doc.setProducer('citaciones-policiales');
  doc.setCreationDate(new Date());

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
  };
  // El escudo se incrusta UNA vez y se reutiliza en todas las paginas.
  const coat = await doc.embedPng(decodeBase64(COAT_OF_ARMS_PNG_BASE64));

  for (let i = 0; i < items.length; i += 1) {
    await drawCitationPage(doc, fonts, coat, items[i]!);
    onProgress?.(i + 1, items.length);
    if (i % 10 === 9) await yieldToEventLoop();
  }

  return await doc.save();
}

/** Compatibilidad: una sola citacion. */
export async function buildCitationPdf(input: CitationPdfInput): Promise<Uint8Array> {
  return await buildCitationsPdf([input]);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
