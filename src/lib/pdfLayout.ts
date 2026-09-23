/**
 * Medidas del formato, extraidas del DOCX original
 * (Citacion_Policial_Formato.docx, word/document.xml).
 *
 * Todo esta en puntos PDF. Las constantes llevan su valor original en twips
 * (1 pt = 20 twips) o pulgadas para poder contrastarlas con el DOCX.
 *
 * El DOCX original NO se modifica. Este modulo solo lo describe.
 */

export const TWIP = 1 / 20;

/** A4: w:pgSz 11906 x 16838 twips. */
export const PAGE_WIDTH = 11906 * TWIP; // 595.3
export const PAGE_HEIGHT = 16838 * TWIP; // 841.9

/** w:pgMar 1134 twips en los cuatro lados (2 cm). */
export const MARGIN = 1134 * TWIP; // 56.7
export const CONTENT_LEFT = MARGIN;
export const CONTENT_WIDTH = 9638 * TWIP; // 481.9 — ancho de las tres tablas
export const CONTENT_RIGHT = CONTENT_LEFT + CONTENT_WIDTH;
export const CONTENT_TOP = PAGE_HEIGHT - MARGIN;

/**
 * Times New Roman es la fuente por defecto del documento (w:docDefaults, sz 22 =
 * 11 pt). El PDF usa la Times estandar, con las mismas metricas.
 */
export const BASE_FONT_SIZE = 11;

/** Metricas de Times New Roman en unidades/2048, para reproducir el interlineado de Word. */
const TNR_ASCENT = 1825 / 2048;
const TNR_DESCENT = 443 / 2048;
const TNR_LINE_GAP = 87 / 2048;
const TNR_LINE_FACTOR = TNR_ASCENT + TNR_DESCENT + TNR_LINE_GAP; // ~1.15

export const ascent = (size: number): number => TNR_ASCENT * size;
export const descent = (size: number): number => TNR_DESCENT * size;
export const lineHeight = (size: number): number => TNR_LINE_FACTOR * size;

/** 1 punto = 12700 EMU. Las imagenes del DOCX vienen medidas en EMU. */
export const EMU = 1 / 12700;

/**
 * Las dos imagenes son FLOTANTES (<wp:anchor> con <wp:wrapNone/>), no en linea.
 * Por eso no ocupan espacio vertical: el texto fluye como si no estuvieran, y su
 * posicion se da como desplazamiento respecto de la columna y del parrafo.
 * Reproducirlo asi es lo que mantiene el documento identico al original.
 */

/** Escudo: extent 720936 x 861590 EMU. */
export const COAT_WIDTH = 720936 * EMU; // 56.77
export const COAT_HEIGHT = 861590 * EMU; // 67.84
/** Anclaje del escudo: posOffset H 2724574 EMU desde la columna, V 15240 desde el parrafo. */
export const COAT_OFFSET_X = 2724574 * EMU; // 214.53
export const COAT_OFFSET_Y = 15240 * EMU; // 1.20

/** Hueco del QR ya previsto por la plantilla: extent 1329266 x 1329266 EMU. */
export const QR_SIZE = 1329266 * EMU; // 104.67
/** Anclaje del QR: posOffset H 120015 EMU desde la celda, V 419735 desde el parrafo. */
export const QR_OFFSET_X = 120015 * EMU; // 9.45
export const QR_OFFSET_Y = 419735 * EMU; // 33.05

/**
 * Recuadro de pagina (w:pgBorders): single, w:sz 12 = 1.5 pt, w:space 24 pt
 * medidos hacia fuera del area de texto.
 */
export const PAGE_BORDER_WIDTH = 12 / 8; // 1.5
export const PAGE_BORDER_SPACE = 24.9;

/**
 * ---------------------------------------------------------------------------
 * ANCLAS DE LA PLANTILLA
 * ---------------------------------------------------------------------------
 * Posiciones medidas sobre la plantilla original renderizada a 300 ppp, en
 * puntos DESDE EL BORDE SUPERIOR de la pagina.
 *
 * Se colocan por anclaje en lugar de reproducir el motor de composicion de Word
 * porque asi el resultado coincide con la plantilla punto por punto, y porque
 * cada valor es comprobable: tests/plantilla.test.ts vuelve a medir el PDF
 * generado y comprueba que cae sobre estas mismas posiciones.
 *
 * Como reproducir la medicion: ver docs/especificacion.md, "Fidelidad del PDF".
 */
export const TEMPLATE = {
  /** Filete bajo "DIRECCION GENERAL DE LA POLICIA NACIONAL". */
  headerRuleY: 190.68,
  /** Linea de escritura de la primera fila de campos. */
  fieldsFirstRuleY: 338.16,
  /** Distancia entre lineas de escritura consecutivas. */
  fieldRowPitch: 19.32,
  /** La linea base del texto de una fila queda por encima de su filete. */
  fieldLabelRise: 8.18,
  /** Linea de firma del Agente Notificador. */
  signatureRuleY: 601.44,
  /** Borde superior e izquierdo del QR (hueco reservado por la plantilla). */
  qrTopY: 619.07,
  qrLeftX: CONTENT_LEFT + 120015 / 12700, // 66.15

  /** Lineas base del texto, medidas igual. */
  baselines: {
    republica: 144.75,
    ministerio: 163.07,
    direccion: 177.72,
    titulo: 245.43,
    codigoEtiqueta: 271.48,
    codigoValor: 283.03,
    sello: 295.14,
    firma: 611.95,
  },
} as const;

/** Convierte una coordenada medida desde arriba a la coordenada PDF (desde abajo). */
export function fromTop(topDown: number): number {
  return PAGE_HEIGHT - topDown;
}

/** Linea base de la fila `index` (0..8) de la tabla de campos. */
export function fieldRuleY(index: number): number {
  return fromTop(TEMPLATE.fieldsFirstRuleY + index * TEMPLATE.fieldRowPitch);
}

export function fieldBaselineY(index: number): number {
  return fieldRuleY(index) + TEMPLATE.fieldLabelRise;
}

/** Grosor de las lineas de escritura (w:sz 6 = 6/8 pt). */
export const RULE_WIDTH = 6 / 8;
/** Filete bajo el encabezado (w:pBdr bottom w:sz 8 = 1 pt). */
export const HEADER_RULE_WIDTH = 8 / 8;

/** Columnas de la tabla de campos: 2700 | 2400 | 900 | 2900 | 738 twips. */
export const FIELD_COLS = [2700, 2400, 900, 2900, 738].map((tw) => tw * TWIP);

/** Margenes interiores de celda de la tabla de campos (w:tcMar). */
export const CELL_PAD_TOP = 60 * TWIP; // 3
export const CELL_PAD_BOTTOM = 60 * TWIP; // 3

/** Tabla del pie: dos columnas de 4819 twips. */
export const FOOTER_COL = 4819 * TWIP; // 240.95
/** Margen interior por defecto de celda en Word: 108 twips. */
export const DEFAULT_CELL_MARGIN = 108 * TWIP; // 5.4

export function fieldColumnX(index: number): number {
  let x = CONTENT_LEFT;
  for (let i = 0; i < index; i += 1) x += FIELD_COLS[i] ?? 0;
  return x;
}
