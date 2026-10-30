/**
 * Мінімальний генератор PDF з однією сторінкою та одним JPEG-зображенням.
 *
 * Аркуш повністю малюється на canvas (карти + підписи + легенда), тому в PDF
 * достатньо вставити готове зображення 300 dpi. Це позбавляє від вбудовування
 * шрифтів і сторонніх бібліотек — файл відкривається будь-яким PDF-читачем.
 */

export interface PdfPageSize {
  widthMm: number;
  heightMm: number;
}

export interface PdfJpegImage {
  blob: Blob;
  widthPx: number;
  heightPx: number;
}

const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;

function encode(text: string): Uint8Array {
  // У PDF-структурі лише ASCII, тому TextEncoder дає потрібні байти.
  return new TextEncoder().encode(text);
}

/** Збирає PDF (одна сторінка, JPEG без стиснення обгортки). */
export async function jpegToPdf(image: PdfJpegImage, page: PdfPageSize): Promise<Blob> {
  const imageBytes = new Uint8Array(await image.blob.arrayBuffer());
  const widthPt = (page.widthMm / MM_PER_INCH) * POINTS_PER_INCH;
  const heightPt = (page.heightMm / MM_PER_INCH) * POINTS_PER_INCH;

  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? encode(data) : data;
    chunks.push(bytes);
    offset += bytes.length;
  };

  const offsets: number[] = [];
  const startObject = (id: number) => {
    offsets[id] = offset;
    push(`${id} 0 obj\n`);
  };

  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');

  startObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObject(2);
  push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  startObject(3);
  push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
  );

  startObject(4);
  push(
    `<< /Type /XObject /Subtype /Image /Width ${image.widthPx} /Height ${image.heightPx} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
  );
  push(imageBytes);
  push('\nendstream\nendobj\n');

  const content = `q\n${widthPt.toFixed(2)} 0 0 ${heightPt.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;
  const contentBytes = encode(content);

  startObject(5);
  push(`<< /Length ${contentBytes.length} >>\nstream\n`);
  push(contentBytes);
  push('endstream\nendobj\n');

  const xrefOffset = offset;
  push('xref\n0 6\n');
  push('0000000000 65535 f \n');
  for (let id = 1; id <= 5; id += 1) {
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
