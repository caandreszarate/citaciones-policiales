// Genera un PDF de muestra para inspeccion visual. Datos ficticios.
import { writeFileSync, mkdirSync } from 'node:fs';

const { buildCitationPdf } = await import('../src/lib/citationPdf.ts');

const out = process.argv[2] ?? 'tmp-artifacts/muestra.pdf';
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
const bytes = await buildCitationPdf({
  registrationCode: '2026-SMII-0000001',
  verificationUrl: 'https://caandreszarate.github.io/citaciones-policiales/#/verificar/0123456789abcdef0123456789abcdef',
  status: 'registrada',
});
writeFileSync(out, bytes);
console.log('PDF escrito en', out, bytes.length, 'bytes');
