/**
 * Comprobacion visual y funcional del PDF final:
 *   1. Genera el PDF con datos ficticios.
 *   2. Lo rasteriza con pdftoppm (poppler) a la resolucion indicada.
 *   3. Lee el QR desde la IMAGEN DE LA PAGINA, no desde el PNG original, para
 *      comprobar que sigue siendo legible tal y como se imprime.
 *
 * Requiere poppler (brew install poppler). Uso:
 *   npm run pdf:check -- [dpi]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

const { buildCitationPdf } = await import('../src/lib/citationPdf.ts');

const dpi = Number(process.argv[2] ?? 150);
const url =
  'https://caandreszarate.github.io/citaciones-policiales/#/verificar/0123456789abcdef0123456789abcdef';
const code = '2026-SMII-0000001';

const dir = mkdtempSync(join(tmpdir(), 'citacion-'));
const pdfPath = join(dir, 'muestra.pdf');
writeFileSync(pdfPath, await buildCitationPdf({ registrationCode: code, verificationUrl: url, status: 'registrada' }));
console.log(`PDF generado: ${pdfPath}`);

execFileSync('pdftoppm', ['-png', '-r', String(dpi), pdfPath, join(dir, 'page')]);
const pngName = readdirSync(dir).find((f) => f.endsWith('.png'));
if (!pngName) throw new Error('pdftoppm no genero ninguna imagen.');
const pngPath = join(dir, pngName);
console.log(`Pagina rasterizada a ${dpi} ppp: ${pngPath}`);

const png = PNG.sync.read(readFileSync(pngPath));
const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
if (!result) {
  console.error(`FALLO: no se pudo leer el QR desde la pagina a ${dpi} ppp.`);
  process.exit(1);
}
console.log(`QR leido desde la pagina (${png.width}x${png.height}):`);
console.log(`  ${result.data}`);
if (result.data !== url) {
  console.error('FALLO: el contenido del QR no coincide con la URL esperada.');
  process.exit(1);
}
console.log('OK: el QR del PDF apunta exactamente a la URL de consulta.');
