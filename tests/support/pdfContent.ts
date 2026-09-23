/**
 * Lector minimo del flujo de contenido de un PDF, para poder MEDIR el documento
 * generado sin depender de herramientas externas.
 *
 * Solo entiende lo que produce nuestro generador: texto con `Tm`/`Tj`, lineas
 * con `m`/`l`/`S` e imagenes con `cm`/`Do`.
 */
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFArray, PDFRawStream, type PDFRef } from 'pdf-lib';

export interface TextItem {
  readonly text: string;
  readonly size: number;
  readonly font: string;
  readonly x: number;
  /** Linea base, en coordenadas PDF (desde abajo). */
  readonly y: number;
}

export interface RuleItem {
  readonly x1: number;
  readonly x2: number;
  readonly y: number;
}

export interface ImageItem {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PageContent {
  readonly texts: TextItem[];
  readonly rules: RuleItem[];
  readonly images: ImageItem[];
}

/** WinAnsi: los acentos del castellano caen en el rango alto de Latin-1. */
function decodeHex(hex: string): string {
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

export async function readPage(bytes: Uint8Array, index = 0): Promise<PageContent> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(index).node.Contents();
  if (!contents) throw new Error('La pagina no tiene contenido.');

  const refs: unknown[] =
    contents instanceof PDFArray ? contents.asArray() : [contents];
  let source = '';
  for (const ref of refs) {
    const stream = contents instanceof PDFArray ? doc.context.lookup(ref as PDFRef) : contents;
    if (!(stream instanceof PDFRawStream)) continue;
    const raw = Buffer.from(stream.getContents());
    let text: string;
    try {
      text = inflateSync(raw).toString('latin1');
    } catch {
      text = raw.toString('latin1');
    }
    source += text + '\n';
  }

  const texts: TextItem[] = [];
  const rules: RuleItem[] = [];
  const images: ImageItem[] = [];

  // Texto: /Fuente <tam> Tf ... 1 0 0 1 X Y Tm ... <hex> Tj
  const textRe =
    /\/([A-Za-z-]+)-\d+ ([\d.]+) Tf[\s\S]*?1 0 0 1 ([-\d.]+) ([-\d.]+) Tm\s*<([0-9A-Fa-f]*)> Tj/g;
  for (let m = textRe.exec(source); m; m = textRe.exec(source)) {
    texts.push({
      font: m[1]!,
      size: Number(m[2]),
      x: Number(m[3]),
      y: Number(m[4]),
      text: decodeHex(m[5]!),
    });
  }

  // Lineas horizontales: X1 Y m ... X2 Y l ... S
  const ruleRe = /([\d.]+) ([\d.]+) m\s+(?:[\d.]+ [\d.]+ m\s+)?([\d.]+) ([\d.]+) l\s+S/g;
  for (let m = ruleRe.exec(source); m; m = ruleRe.exec(source)) {
    const y1 = Number(m[2]);
    const y2 = Number(m[4]);
    if (Math.abs(y1 - y2) < 0.01) {
      rules.push({ x1: Number(m[1]), x2: Number(m[3]), y: y1 });
    }
  }

  // Imagenes: 1 0 0 1 X Y cm ... W 0 0 H 0 0 cm ... Do
  const imgRe =
    /1 0 0 1 ([-\d.]+) ([-\d.]+) cm[\s\S]{0,60}?([\d.]+) 0 0 ([\d.]+) 0 0 cm[\s\S]{0,40}?\/[A-Za-z0-9-]+ Do/g;
  for (let m = imgRe.exec(source); m; m = imgRe.exec(source)) {
    images.push({
      x: Number(m[1]),
      y: Number(m[2]),
      width: Number(m[3]),
      height: Number(m[4]),
    });
  }

  return { texts, rules, images };
}

/** Busca el primer texto que coincide exactamente. */
export function findText(content: PageContent, text: string): TextItem | undefined {
  return content.texts.find((t) => t.text === text);
}
