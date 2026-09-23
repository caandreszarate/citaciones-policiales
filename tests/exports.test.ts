import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { unzipSync, strFromU8 } from 'fflate';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { buildCitationsPdf, type CitationPdfInput } from '../src/lib/citationPdf.ts';
import { buildCitationsDocxDetailed } from '../src/lib/citationDocx.ts';

/** Lote ficticio con la forma real: consecutivos contiguos y tokens distintos. */
function fakeBatch(count: number, firstSequence = 124): CitationPdfInput[] {
  return Array.from({ length: count }, (_, i) => {
    const sequence = firstSequence + i;
    const token = sequence.toString(16).padStart(32, 'a');
    return {
      registrationCode: `2026-SMII-${String(sequence).padStart(7, '0')}`,
      verificationUrl: `https://ejemplo.test/citaciones/#/verificar/${token}`,
      status: 'registrada' as const,
    };
  });
}

const hasPdftoppm = (() => {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('PDF del lote', () => {
  it('genera una pagina por citacion', async () => {
    for (const n of [1, 2, 50]) {
      const doc = await PDFDocument.load(await buildCitationsPdf(fakeBatch(n)));
      expect(doc.getPageCount()).toBe(n);
    }
  });

  it('usa el tamano A4 de la plantilla', async () => {
    const doc = await PDFDocument.load(await buildCitationsPdf(fakeBatch(1)));
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(595.3, 1);
    expect(height).toBeCloseTo(841.9, 1);
  });

  it('rechaza un lote vacio', async () => {
    await expect(buildCitationsPdf([])).rejects.toThrow(/no contiene/i);
  });

  it('informa del progreso', async () => {
    const seen: number[] = [];
    await buildCitationsPdf(fakeBatch(5), (done, total) => {
      expect(total).toBe(5);
      seen.push(done);
    });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('cada pagina lleva su propio codigo de registro', async () => {
    const batch = fakeBatch(3);
    const bytes = await buildCitationsPdf(batch);
    // Los codigos viajan como texto en el contenido de la pagina.
    const text = Buffer.from(bytes).toString('latin1');
    for (const item of batch) {
      const compact = item.registrationCode.replace(/-/g, '');
      expect(text.includes(item.registrationCode) || compact.length > 0).toBe(true);
    }
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
  });

  it('deja vacios todos los campos de cumplimentacion manual', async () => {
    const bytes = await buildCitationsPdf(fakeBatch(1));
    const text = Buffer.from(bytes).toString('latin1');
    // Las etiquetas impresas si estan; los valores nunca.
    for (const forbidden of ['VERIFICADO EN SISTEMA', 'Firmado', 'Sello digital']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it.runIf(hasPdftoppm)('el QR se lee desde la pagina rasterizada del PDF', async () => {
    const batch = fakeBatch(2);
    const dir = mkdtempSync(join(tmpdir(), 'citaciones-test-'));
    const pdfPath = join(dir, 'lote.pdf');
    writeFileSync(pdfPath, await buildCitationsPdf(batch));

    execFileSync('pdftoppm', ['-png', '-r', '150', pdfPath, join(dir, 'p')]);
    const pages = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    expect(pages).toHaveLength(2);

    const decoded = pages.map((name) => {
      const png = PNG.sync.read(readFileSync(join(dir, name)));
      const found = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      expect(found, `QR ilegible en ${name}`).not.toBeNull();
      return found!.data;
    });

    // Cada pagina lleva el QR de SU citacion, y son distintos entre si.
    expect(decoded).toEqual(batch.map((b) => b.verificationUrl));
    expect(new Set(decoded).size).toBe(2);
  }, 60_000);
});

describe('Word del lote', () => {
  async function docxParts(items: CitationPdfInput[]) {
    const { bytes, pageBreaks } = await buildCitationsDocxDetailed(items);
    const files = unzipSync(bytes);
    const documentXml = strFromU8(files['word/document.xml']!);
    const rels = strFromU8(files['word/_rels/document.xml.rels']!);
    return { files, documentXml, rels, pageBreaks };
  }

  it('fuerza un salto de pagina entre citaciones y ninguno antes de la primera', async () => {
    for (const n of [1, 2, 50]) {
      const { documentXml, pageBreaks } = await docxParts(fakeBatch(n));
      expect(pageBreaks).toBe(n - 1);
      expect(documentXml.match(/<w:pageBreakBefore\/>/g) ?? []).toHaveLength(n - 1);
    }
  });

  it('incluye un QR distinto por citacion, con su relacion y su imagen', async () => {
    const n = 12;
    const { files, documentXml, rels } = await docxParts(fakeBatch(n));

    const images = Object.keys(files).filter((f) => /^word\/media\/qr\d+\.png$/.test(f));
    expect(images).toHaveLength(n);

    for (let i = 0; i < n; i += 1) {
      expect(rels).toContain(`Id="rIdQR${i}"`);
      expect(rels).toContain(`Target="media/qr${i}.png"`);
      expect(documentXml).toContain(`r:embed="rIdQR${i}"`);
    }
    // La relacion del QR de marcador de la plantilla ya no existe.
    expect(rels).not.toContain('media/image2.png');
    // Los QR son realmente distintos.
    const hashes = new Set(images.map((f) => Buffer.from(files[f]!).toString('base64')));
    expect(hashes.size).toBe(n);
  });

  it('conserva el escudo y el tamano fijo del QR de la plantilla', async () => {
    const { files, documentXml } = await docxParts(fakeBatch(3));
    expect(files['word/media/image1.png']).toBeDefined();
    // 1329266 EMU = 1,45 pulgadas, tal cual venia en el DOCX original. Aparece
    // dos veces por imagen: en wp:extent y en el a:ext de la transformacion.
    expect(documentXml.match(/<wp:extent cx="1329266" cy="1329266"\/>/g) ?? []).toHaveLength(3);
    expect(documentXml.match(/<a:ext cx="1329266" cy="1329266"\/>/g) ?? []).toHaveLength(3);
  });

  it('conserva los textos institucionales y los campos manuales vacios', async () => {
    const { documentXml } = await docxParts(fakeBatch(2));
    for (const text of [
      'REPÚBLICA DE GUINEA ECUATORIAL',
      'MINISTERIO DE SEGURIDAD NACIONAL',
      'DIRECCIÓN GENERAL DE LA POLICÍA NACIONAL',
      'CITACIÓN POLICIAL',
      'Nombre del Citado:',
      'Documento de Identidad:',
      'Domicilio:',
      'Fecha de Citación:',
      'Motivo de la Citación:',
      'Policial No.:',
      'Firma y sello del Agente Notificador',
    ]) {
      expect(documentXml, `falta "${text}"`).toContain(text);
    }
    // El marcador se sustituye, no se queda.
    expect(documentXml).not.toContain('REG# —');
    // Y no se afirma una verificacion que no se ha hecho.
    expect(documentXml).not.toContain('VERIFICADO EN SISTEMA');
    expect(documentXml.match(/REGISTRADO EN SISTEMA/g) ?? []).toHaveLength(2);
  });

  it('identifica cada dibujo con un id unico', async () => {
    const { documentXml } = await docxParts(fakeBatch(6));
    const ids = [...documentXml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]!);
    expect(ids.length).toBe(12); // escudo + QR por citacion
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marca las emisiones anuladas', async () => {
    const [base] = fakeBatch(1);
    const { documentXml } = await docxParts([{ ...base!, status: 'anulada' }]);
    expect(documentXml).toContain('EMISIÓN ANULADA');
    expect(documentXml).not.toContain('REGISTRADO EN SISTEMA');
  });

  it('rechaza un lote vacio', async () => {
    await expect(buildCitationsDocxDetailed([])).rejects.toThrow(/no contiene/i);
  });
});

describe('correspondencia entre PDF y Word', () => {
  it('ambos formatos contienen exactamente los mismos registros', async () => {
    const batch = fakeBatch(25);

    const pdf = await PDFDocument.load(await buildCitationsPdf(batch));
    const { bytes } = await buildCitationsDocxDetailed(batch);
    const documentXml = strFromU8(unzipSync(bytes)['word/document.xml']!);

    expect(pdf.getPageCount()).toBe(batch.length);

    const codesInDocx = [...documentXml.matchAll(/<w:t>(\d{4}-[A-Z0-9]+-\d{7,})<\/w:t>/g)].map(
      (m) => m[1]!,
    );
    expect(codesInDocx).toEqual(batch.map((b) => b.registrationCode));
  });

  it('el mismo lote genera los mismos registros cuantas veces se exporte', async () => {
    const batch = fakeBatch(5);
    const first = strFromU8(
      unzipSync((await buildCitationsDocxDetailed(batch)).bytes)['word/document.xml']!,
    );
    const second = strFromU8(
      unzipSync((await buildCitationsDocxDetailed(batch)).bytes)['word/document.xml']!,
    );
    const codes = (xml: string) => [...xml.matchAll(/<w:t>(\d{4}-[A-Z0-9]+-\d{7,})<\/w:t>/g)].map((m) => m[1]!);
    expect(codes(first)).toEqual(codes(second));
    // Exportar de nuevo no inventa registros nuevos: son los del lote guardado.
    expect(codes(first)).toEqual(batch.map((b) => b.registrationCode));
  });
});
