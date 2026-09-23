import type { CitationPdfInput } from '../lib/citationPdf.ts';

/**
 * pdf-lib, qrcode y fflate solo hacen falta al exportar. Se cargan bajo demanda
 * para que la consulta publica -- que es la que se abre al escanear un QR, a
 * menudo desde un movil -- no tenga que descargarlos.
 */

/** Formatos de descarga. El PDF es el recomendado para imprimir. */
export type ExportFormat = 'pdf' | 'docx';

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  pdf: 'PDF (recomendado para imprimir)',
  docx: 'Word (.docx)',
};

const MIME: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Descarga unos bytes como archivo, sin salir de la pagina. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mime: string): void {
  const view = new Uint8Array(bytes.length);
  view.set(bytes);
  const url = URL.createObjectURL(new Blob([view.buffer], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Se libera despues del clic para que el navegador llegue a leer el blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportCitations(
  pages: readonly CitationPdfInput[],
  format: ExportFormat,
  fileName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  let bytes: Uint8Array;
  if (format === 'pdf') {
    const { buildCitationsPdf } = await import('../lib/citationPdf.ts');
    bytes = await buildCitationsPdf(pages, onProgress);
  } else {
    const { buildCitationsDocx } = await import('../lib/citationDocx.ts');
    bytes = await buildCitationsDocx(pages, onProgress);
  }
  downloadBytes(bytes, fileName, MIME[format]);
}

/** Descarga suelta del QR de una citacion, en PNG. */
export async function downloadQrPng(
  verificationUrl: string,
  registrationCode: string,
): Promise<void> {
  const { renderQrPng } = await import('../lib/citationPdf.ts');
  const png = await renderQrPng(verificationUrl);
  downloadBytes(png, `qr_${registrationCode}.png`, 'image/png');
}
