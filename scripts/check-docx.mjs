/**
 * Comprobacion del Word exportado: genera un lote, lo convierte a PDF con
 * LibreOffice y verifica el numero de paginas y la lectura de cada QR.
 *
 * Requiere Docker (se usa una imagen con LibreOffice) y poppler.
 * Uso: node scripts/check-docx.mjs [cantidad]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

const { buildCitationsDocx } = await import('../src/lib/citationDocx.ts');

const count = Number(process.argv[2] ?? 3);
const pages = Array.from({ length: count }, (_, i) => {
  const sequence = 124 + i;
  return {
    registrationCode: `2026-SMII-${String(sequence).padStart(7, '0')}`,
    verificationUrl: `https://ejemplo.test/citaciones/#/verificar/${sequence.toString(16).padStart(32, 'a')}`,
    status: 'registrada',
  };
});

const dir = mkdtempSync(join(tmpdir(), 'citaciones-docx-'));
writeFileSync(join(dir, 'lote.docx'), await buildCitationsDocx(pages));
console.log(`Word generado con ${count} citaciones: ${join(dir, 'lote.docx')}`);

execFileSync('docker', [
  'run', '--rm', '-v', `${dir}:/data`, '--entrypoint', '/bin/bash',
  'linuxserver/libreoffice:latest',
  '-c', 'cd /data && soffice --headless --convert-to pdf lote.docx --outdir /data',
], { stdio: 'inherit' });

const pdfPath = join(dir, 'lote.pdf');
const paginas = Number(
  execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' }).match(/Pages:\s+(\d+)/)?.[1] ?? '0',
);
console.log(`Paginas del PDF convertido: ${paginas} (esperado ${count})`);
if (paginas !== count) {
  console.error('FALLO: el numero de paginas no coincide con la cantidad de citaciones.');
  process.exit(1);
}

execFileSync('pdftoppm', ['-png', '-r', '150', pdfPath, join(dir, 'p')]);
const imagenes = readdirSync(dir).filter((f) => f.startsWith('p-') && f.endsWith('.png')).sort();

let fallos = 0;
imagenes.forEach((name, i) => {
  const png = PNG.sync.read(readFileSync(join(dir, name)));
  const found = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  const esperado = pages[i].verificationUrl;
  if (!found) {
    console.error(`  pagina ${i + 1}: QR ILEGIBLE`);
    fallos += 1;
  } else if (found.data !== esperado) {
    console.error(`  pagina ${i + 1}: QR incorrecto -> ${found.data}`);
    fallos += 1;
  } else {
    console.log(`  pagina ${i + 1}: QR correcto (${pages[i].registrationCode})`);
  }
});

console.log(`Salida en ${dir}`);
if (fallos > 0) process.exit(1);
console.log('OK: Word con una citacion por pagina y QR legible en todas.');
