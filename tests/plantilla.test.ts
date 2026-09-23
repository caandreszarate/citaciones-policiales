import { describe, it, expect, beforeAll } from 'vitest';
import { buildCitationsPdf } from '../src/lib/citationPdf.ts';
import * as L from '../src/lib/pdfLayout.ts';
import { readPage, findText, type PageContent } from './support/pdfContent.ts';

/**
 * Fidelidad frente a la plantilla original.
 *
 * Las posiciones esperadas se midieron sobre Citacion_Policial_Formato.docx
 * renderizado a 300 ppp (ver docs/especificacion.md, "Fidelidad del PDF").
 * Esta prueba vuelve a medir el PDF que genera la aplicacion y comprueba que
 * cae sobre las mismas coordenadas, de modo que una regresion de maquetacion
 * se detecta sola.
 */

const TOLERANCIA = 0.5;
const CODIGO = '2026-SMII-0000124';
const URL = `https://ejemplo.test/citaciones/#/verificar/${'ab'.repeat(16)}`;

/** Posiciones de la plantilla, en puntos desde el borde SUPERIOR de la pagina. */
const ESPERADO = {
  textos: [
    { texto: 'REPÚBLICA DE GUINEA ECUATORIAL', tam: 15, yArriba: 144.75 },
    { texto: 'MINISTERIO DE SEGURIDAD NACIONAL', tam: 11, yArriba: 163.07 },
    { texto: 'DIRECCIÓN GENERAL DE LA POLICÍA NACIONAL', tam: 11, yArriba: 177.72 },
    { texto: 'CITACIÓN POLICIAL', tam: 16, yArriba: 245.43 },
    { texto: 'CÓDIGO DE REGISTRO:', tam: 10, yArriba: 271.48 },
    { texto: 'Firma y sello del Agente Notificador', tam: 10, yArriba: 611.95 },
  ],
  fileteEncabezado: 190.68,
  primerFileteCampos: 338.16,
  pasoEntreFilas: 19.32,
  fileteFirma: 601.44,
} as const;

let pagina: PageContent;

beforeAll(async () => {
  pagina = await readPage(
    await buildCitationsPdf([
      { registrationCode: CODIGO, verificationUrl: URL, status: 'registrada' },
    ]),
  );
});

const desdeArriba = (y: number) => L.PAGE_HEIGHT - y;

describe('tamano de pagina y recuadro', () => {
  it('es A4 con los margenes del DOCX', () => {
    expect(L.PAGE_WIDTH).toBeCloseTo(595.3, 1);
    expect(L.PAGE_HEIGHT).toBeCloseTo(841.89, 1);
    expect(L.MARGIN).toBeCloseTo(56.7, 2); // 1134 twips = 2 cm
    expect(L.CONTENT_WIDTH).toBeCloseTo(481.9, 1); // 9638 twips
  });

  it('dibuja el recuadro de pagina de la plantilla', () => {
    // w:pgBorders, a 24,9 pt por fuera del area de texto: borde superior a 31,8.
    expect(L.CONTENT_LEFT - L.PAGE_BORDER_SPACE).toBeCloseTo(31.8, 1);
  });
});

describe('textos institucionales', () => {
  it.each(ESPERADO.textos)(
    'coloca "$texto" donde la plantilla',
    ({ texto, tam, yArriba }) => {
      const encontrado = findText(pagina, texto);
      expect(encontrado, `no se encontro "${texto}"`).toBeDefined();
      expect(encontrado!.size).toBe(tam);
      expect(desdeArriba(encontrado!.y)).toBeCloseTo(yArriba, 1);
    },
  );

  it('conserva los acentos y la eñe del castellano', () => {
    expect(findText(pagina, 'REPÚBLICA DE GUINEA ECUATORIAL')).toBeDefined();
    expect(findText(pagina, 'DIRECCIÓN GENERAL DE LA POLICÍA NACIONAL')).toBeDefined();
    expect(findText(pagina, 'CITACIÓN POLICIAL')).toBeDefined();
  });
});

describe('etiquetas de los campos manuales', () => {
  const etiquetas = [
    ['Nombre del Citado:', 0],
    ['Documento de Identidad:', 1],
    ['Domicilio:', 2],
    ['Fecha de Citación:', 3],
    ['Lugar:', 4],
    ['Motivo de la Citación:', 6],
    ['Policial No.:', 8],
  ] as const;

  it.each(etiquetas)('"%s" esta en la fila %i', (texto, fila) => {
    const item = findText(pagina, texto);
    expect(item, `falta la etiqueta "${texto}"`).toBeDefined();
    expect(item!.x).toBeCloseTo(L.CONTENT_LEFT, 1);
    expect(item!.y).toBeCloseTo(L.fieldBaselineY(fila), 1);
  });

  it('mantiene "Hora:" y "horas" en la fila de la comparecencia', () => {
    for (const texto of ['Hora:', ' horas']) {
      const item = findText(pagina, texto);
      expect(item, `falta "${texto}"`).toBeDefined();
      expect(item!.y).toBeCloseTo(L.fieldBaselineY(3), 1);
    }
  });
});

describe('lineas de escritura', () => {
  it('traza las nueve lineas en las posiciones de la plantilla', () => {
    const esperadas = Array.from(
      { length: 9 },
      (_, i) => ESPERADO.primerFileteCampos + i * ESPERADO.pasoEntreFilas,
    );
    for (const y of esperadas) {
      const encontrada = pagina.rules.find((r) => Math.abs(desdeArriba(r.y) - y) < TOLERANCIA);
      expect(encontrada, `falta la linea de escritura a ${y} pt`).toBeDefined();
    }
  });

  it('traza el filete del encabezado a lo ancho del contenido', () => {
    const filete = pagina.rules.find(
      (r) => Math.abs(desdeArriba(r.y) - ESPERADO.fileteEncabezado) < TOLERANCIA,
    );
    expect(filete).toBeDefined();
    expect(filete!.x1).toBeCloseTo(L.CONTENT_LEFT, 1);
    expect(filete!.x2).toBeCloseTo(L.CONTENT_RIGHT, 1);
  });

  it('traza la linea de firma en la mitad derecha', () => {
    const filete = pagina.rules.find(
      (r) => Math.abs(desdeArriba(r.y) - ESPERADO.fileteFirma) < TOLERANCIA,
    );
    expect(filete).toBeDefined();
    expect(filete!.x1).toBeCloseTo(L.CONTENT_LEFT + L.FOOTER_COL, 1);
    expect(filete!.x2).toBeCloseTo(L.CONTENT_RIGHT, 1);
  });

  it('deja libre el ancho de escritura de cada fila', () => {
    // Las lineas largas de ESCRITURA van de la columna de etiquetas al margen
    // derecho. Se excluye el filete del encabezado, que ocupa todo el ancho.
    const largas = pagina.rules.filter(
      (r) =>
        r.x2 - r.x1 > 300 &&
        Math.abs(desdeArriba(r.y) - ESPERADO.fileteEncabezado) >= TOLERANCIA,
    );
    expect(largas.length).toBeGreaterThanOrEqual(6);
    for (const r of largas) {
      expect(r.x1).toBeCloseTo(L.fieldColumnX(1), 1);
      expect(r.x2).toBeCloseTo(L.CONTENT_RIGHT, 1);
    }
  });
});

describe('lo unico que anade la aplicacion', () => {
  it('escribe el codigo de registro en la linea reservada de la plantilla', () => {
    const item = findText(pagina, CODIGO);
    expect(item).toBeDefined();
    expect(item!.size).toBe(10);
    // La plantilla situa ahi "REG# — ____ — ____ — ____": linea base a 283,03 pt
    // (el borde superior de sus glifos queda en 276,19, el valor medido).
    expect(desdeArriba(item!.y)).toBeCloseTo(283.03, 1);
    // Alineado a la derecha, como en la plantilla.
    expect(item!.x).toBeGreaterThan(L.CONTENT_RIGHT - 120);
  });

  it('coloca el QR en el hueco de 1,45 pulgadas que reserva la plantilla', () => {
    const qr = pagina.images.find((i) => Math.abs(i.width - L.QR_SIZE) < 0.5);
    expect(qr, 'no se encontro la imagen del QR').toBeDefined();
    expect(qr!.width).toBeCloseTo(L.QR_SIZE, 1);
    expect(qr!.height).toBeCloseTo(L.QR_SIZE, 1);
    expect(qr!.x).toBeCloseTo(L.TEMPLATE.qrLeftX, 1);
    expect(desdeArriba(qr!.y + qr!.height)).toBeCloseTo(L.TEMPLATE.qrTopY, 1);
  });

  it('el QR no invade la mitad de la firma ni las lineas de escritura', () => {
    const qr = pagina.images.find((i) => Math.abs(i.width - L.QR_SIZE) < 0.5)!;
    // A la izquierda de la columna de la firma.
    expect(qr.x + qr.width).toBeLessThan(L.CONTENT_LEFT + L.FOOTER_COL);
    // Por debajo de la ultima linea de escritura.
    const ultimaFila = L.fieldRuleY(8);
    expect(qr.y + qr.height).toBeLessThan(ultimaFila);
  });

  it('mantiene el escudo con el tamano y la posicion del DOCX', () => {
    const escudo = pagina.images.find((i) => Math.abs(i.width - L.COAT_WIDTH) < 0.5);
    expect(escudo).toBeDefined();
    expect(escudo!.height).toBeCloseTo(L.COAT_HEIGHT, 1);
    expect(escudo!.x).toBeCloseTo(L.CONTENT_LEFT + L.COAT_OFFSET_X, 1);
  });
});

describe('campos de cumplimentacion manual', () => {
  it('no imprime ningun valor: solo las etiquetas de la plantilla', () => {
    const permitidos = new Set([
      'REPÚBLICA DE GUINEA ECUATORIAL',
      'MINISTERIO DE SEGURIDAD NACIONAL',
      'DIRECCIÓN GENERAL DE LA POLICÍA NACIONAL',
      'CITACIÓN POLICIAL',
      'CÓDIGO DE REGISTRO:',
      'REGISTRADO EN SISTEMA',
      'Nombre del Citado:',
      'Documento de Identidad:',
      'DIP ',
      'Domicilio:',
      'Fecha de Citación:',
      'Hora:',
      ' horas',
      'Lugar:',
      'Motivo de la Citación:',
      'Policial No.:',
      'Firma y sello del Agente Notificador',
      'Escanee para consultar la emisión de este formato.',
      'No acredita lo escrito a mano, la firma ni el sello.',
      CODIGO,
    ]);
    const inesperados = pagina.texts.map((t) => t.text).filter((t) => !permitidos.has(t));
    expect(inesperados, `textos no previstos: ${inesperados.join(' | ')}`).toEqual([]);
  });

  it('no afirma una verificacion que no se ha hecho', () => {
    expect(findText(pagina, 'VERIFICADO EN SISTEMA')).toBeUndefined();
    expect(findText(pagina, 'REGISTRADO EN SISTEMA')).toBeDefined();
  });

  it('marca las emisiones anuladas en lugar del sello normal', async () => {
    const anulada = await readPage(
      await buildCitationsPdf([
        { registrationCode: CODIGO, verificationUrl: URL, status: 'anulada' },
      ]),
    );
    expect(findText(anulada, 'EMISIÓN ANULADA')).toBeDefined();
    expect(findText(anulada, 'REGISTRADO EN SISTEMA')).toBeUndefined();
  });

  it('declara el alcance de la consulta sin prometer autenticidad del contenido', () => {
    expect(findText(pagina, 'No acredita lo escrito a mano, la firma ni el sello.')).toBeDefined();
  });
});

describe('lotes', () => {
  it('cada pagina lleva su propio codigo y su propio QR', async () => {
    const lote = [
      { registrationCode: '2026-BN-0000001', verificationUrl: `${URL}1`, status: 'registrada' as const },
      { registrationCode: '2026-BN-0000002', verificationUrl: `${URL}2`, status: 'registrada' as const },
      { registrationCode: '2026-BN-0000003', verificationUrl: `${URL}3`, status: 'registrada' as const },
    ];
    const bytes = await buildCitationsPdf(lote);
    for (let i = 0; i < lote.length; i += 1) {
      const p = await readPage(bytes, i);
      expect(findText(p, lote[i]!.registrationCode), `pagina ${i + 1}`).toBeDefined();
      // Y no lleva el de ninguna otra pagina.
      for (let j = 0; j < lote.length; j += 1) {
        if (j !== i) expect(findText(p, lote[j]!.registrationCode)).toBeUndefined();
      }
      expect(p.images.some((im) => Math.abs(im.width - L.QR_SIZE) < 0.5)).toBe(true);
    }
  });
});
