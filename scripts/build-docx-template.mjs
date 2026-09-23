/**
 * Genera src/lib/docxTemplate.ts a partir de la plantilla DOCX original.
 *
 * El archivo original NO se modifica: se lee, se le quitan las dos imagenes
 * (el escudo ya viaja en coatOfArms.ts y el QR se genera por citacion) y el
 * resto del paquete OOXML se incrusta tal cual, en base64.
 *
 * Reconstruir la plantilla:
 *   node scripts/build-docx-template.mjs ~/Downloads/Citacion_Policial_Formato.docx
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync } from 'fflate';

const source = process.argv[2] ?? `${process.env.HOME}/Downloads/Citacion_Policial_Formato.docx`;
const original = unzipSync(new Uint8Array(readFileSync(source)));

const kept = {};
for (const [name, bytes] of Object.entries(original)) {
  if (name.startsWith('word/media/')) continue; // se inyectan en tiempo de generacion
  kept[name] = bytes;
}

const zipped = zipSync(kept, { level: 9 });
const b64 = Buffer.from(zipped).toString('base64');
const lines = b64.match(/.{1,100}/g) ?? [];

writeFileSync(
  'src/lib/docxTemplate.ts',
  `/**
 * Plantilla DOCX original (${source.split('/').pop()}) sin sus imagenes, en base64.
 *
 * Generado por scripts/build-docx-template.mjs. NO editar a mano.
 *
 * Al conservar el paquete OOXML original intacto (document.xml, styles.xml,
 * theme, fontTable...), el Word exportado mantiene exactamente el diseno, los
 * textos y los espacios de escritura de la plantilla facilitada. La generacion
 * solo sustituye el codigo de registro e inyecta el QR de cada citacion.
 *
 * Las imagenes se anaden al generar:
 *   word/media/image1.png -> escudo (src/lib/coatOfArms.ts)
 *   word/media/qrN.png    -> QR de cada citacion
 */
export const DOCX_TEMPLATE_BASE64 =
${lines.map((l) => `  '${l}' +`).join('\n').slice(0, -2)};
`,
);
console.log(`Plantilla: ${zipped.length} bytes comprimidos, ${b64.length} caracteres base64`);
console.log('Partes conservadas:', Object.keys(kept).join(', '));
