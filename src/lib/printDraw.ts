/**
 * Малювання аркуша експорту на canvas.
 *
 * Один і той самий код малює і попередній перегляд (96 dpi), і фінальний PDF
 * (300 dpi): різниця лише в `dpi`, тому попередній перегляд відповідає друку.
 * Карти (основна та врізка) малюються окремо — їх дають знімки ArcGIS MapView.
 */

import {
  mapFrame,
  scaleBarSpec,
  type ElementVisibility,
  type PageMm,
  type PrintLayout,
  type RectMm,
} from './printLayout';

export interface SheetTexts {
  /** Перший рядок шапки, наприклад «CASEVAC 12.5 км». */
  heading: string;
  /** Другий рядок шапки — ділянка розмінування. */
  subheading: string;
  /** Підпис врізки: адреса або назва закладу. */
  facilityCaption: string;
}

export interface SheetDrawOptions {
  page: PageMm;
  layout: PrintLayout;
  visible: ElementVisibility;
  texts: SheetTexts;
  /** Масштаб основної карти (знаменник). */
  scale: number;
  /** Масштаб врізки (знаменник). */
  insetScale: number;
  /** Роздільна здатність полотна. */
  dpi: number;
  logo?: CanvasImageSource | null;
  northArrow?: CanvasImageSource | null;
}

const FONT_FAMILY = "'DM Sans', 'Segoe UI', Arial, sans-serif";
const INK = '#111111';
const FACILITY_BLUE = '#2d6fbf';
const ROUTE_RED = '#e53935';

function font(sizeMm: number, weight: number, dpi: number): string {
  return `${weight} ${(sizeMm * dpi) / 25.4}px ${FONT_FAMILY}`;
}

/** Зменшує шрифт, доки текст не влізе у ширину. */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number,
  sizeMm: number,
  weight: number,
  dpi: number,
  minMm = 1.6,
): number {
  let size = sizeMm;
  while (size > minMm) {
    ctx.font = font(size, weight, dpi);
    if (ctx.measureText(text).width <= maxWidthPx) break;
    size -= 0.2;
  }
  return size;
}

/**
 * Розбиває текст на рядки за шириною, не змінюючи розмір шрифту.
 * Довгі слова (наприклад, складні адреси без пробілів) переносяться по символах.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxWidthPx <= 0) return [];

  const lines: string[] = [];
  let current = '';

  const breakWord = (word: string): string => {
    let chunk = '';
    for (const char of word) {
      if (ctx.measureText(chunk + char).width <= maxWidthPx) {
        chunk += char;
      } else {
        if (chunk) lines.push(chunk);
        chunk = char;
      }
    }
    return chunk;
  };

  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidthPx) {
      current = candidate;
      return;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    current = ctx.measureText(word).width > maxWidthPx ? breakWord(word) : word;
  });
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;

  // Якщо рядків забагато — обрізаємо останній і додаємо трикрапку.
  const visible = lines.slice(0, maxLines);
  let last = visible[maxLines - 1];
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidthPx) {
    last = last.slice(0, -1);
  }
  visible[maxLines - 1] = `${last}…`;
  return visible;
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  rect: RectMm,
  dpi: number,
  options: { fill?: string; border?: string; borderMm?: number } = {},
): void {
  const { x, y, w, h } = toPx(rect, dpi);
  if (options.fill) {
    ctx.fillStyle = options.fill;
    ctx.fillRect(x, y, w, h);
  }
  if (options.border) {
    ctx.strokeStyle = options.border;
    ctx.lineWidth = ((options.borderMm ?? 0.4) * dpi) / 25.4;
    ctx.strokeRect(x, y, w, h);
  }
}

function toPx(rect: RectMm, dpi: number): { x: number; y: number; w: number; h: number } {
  const k = dpi / 25.4;
  return { x: rect.xMm * k, y: rect.yMm * k, w: rect.wMm * k, h: rect.hMm * k };
}

/** Зображення вписується у прямокутник із збереженням пропорцій. */
function drawImageFit(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  rect: RectMm,
  dpi: number,
  paddingMm: number,
): void {
  const natural = imageSize(image);
  if (!natural) return;
  const k = dpi / 25.4;
  const availW = Math.max(1, (rect.wMm - paddingMm * 2) * k);
  const availH = Math.max(1, (rect.hMm - paddingMm * 2) * k);
  const ratio = Math.min(availW / natural.width, availH / natural.height);
  const w = natural.width * ratio;
  const h = natural.height * ratio;
  const x = rect.xMm * k + (rect.wMm * k - w) / 2;
  const y = rect.yMm * k + (rect.hMm * k - h) / 2;
  ctx.drawImage(image, x, y, w, h);
}

function imageSize(image: CanvasImageSource): { width: number; height: number } | null {
  const candidate = image as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const width = candidate.naturalWidth || candidate.width || 0;
  const height = candidate.naturalHeight || candidate.height || 0;
  if (width > 0 && height > 0) return { width, height };
  return { width: 100, height: 100 };
}

function formatDistance(meters: number, totalMeters: number): string {
  if (totalMeters >= 1000) {
    const km = meters / 1000;
    return Number.isInteger(km) ? String(km) : km.toFixed(1);
  }
  return String(Math.round(meters));
}

function drawHeader(ctx: CanvasRenderingContext2D, rect: RectMm, texts: SheetTexts, dpi: number): void {
  drawBox(ctx, rect, dpi, { fill: '#ffffff', border: INK, borderMm: 0.4 });
  const k = dpi / 25.4;
  const cx = (rect.xMm + rect.wMm / 2) * k;
  const maxW = (rect.wMm - 6) * k;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;

  const titleSize = fitFont(ctx, texts.heading, maxW, 4.6, 700, dpi, 2.4);
  ctx.font = font(titleSize, 700, dpi);
  ctx.fillText(texts.heading, cx, (rect.yMm + rect.hMm * 0.36) * k);

  const subSize = fitFont(ctx, texts.subheading, maxW, 4, 400, dpi, 2.6);
  ctx.font = font(subSize, 400, dpi);
  ctx.fillText(texts.subheading, cx, (rect.yMm + rect.hMm * 0.73) * k);
}

function drawLegend(ctx: CanvasRenderingContext2D, rect: RectMm, dpi: number): void {
  drawBox(ctx, rect, dpi, { fill: '#ffffff', border: INK, borderMm: 0.4 });
  const k = dpi / 25.4;
  const left = (rect.xMm + 3) * k;
  const titleY = (rect.yMm + 5) * k;

  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(2.9, 700, dpi);
  ctx.fillText('Умовні позначення', left, titleY);

  const rows = [
    { label: 'Медичний заклад', kind: 'facility' as const },
    { label: 'Початок евакуації', kind: 'start' as const },
    { label: 'Маршрут евакуації', kind: 'route' as const },
  ];
  const rowH = (rect.hMm - 9) / rows.length;
  rows.forEach((row, index) => {
    const cyMm = rect.yMm + 9 + rowH * index + rowH / 2;
    const cy = cyMm * k;
    const centerX = (rect.xMm + 8) * k;

    if (row.kind === 'facility') {
      ctx.beginPath();
      ctx.arc(centerX, cy, 2.4 * k, 0, Math.PI * 2);
      ctx.fillStyle = FACILITY_BLUE;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.45 * k;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = font(2.6, 700, dpi);
      ctx.textAlign = 'center';
      ctx.fillText('H', centerX, cy + 0.1 * k);
      ctx.textAlign = 'left';
    } else if (row.kind === 'start') {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.6 * k;
      ctx.beginPath();
      ctx.moveTo(centerX - 2.2 * k, cy);
      ctx.lineTo(centerX + 2.2 * k, cy);
      ctx.moveTo(centerX, cy - 2.2 * k);
      ctx.lineTo(centerX, cy + 2.2 * k);
      ctx.stroke();
    } else {
      ctx.strokeStyle = ROUTE_RED;
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      ctx.moveTo(centerX - 3.5 * k, cy);
      ctx.lineTo(centerX + 3.5 * k, cy);
      ctx.stroke();
    }

    ctx.fillStyle = INK;
    ctx.font = font(2.7, 500, dpi);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.label, (rect.xMm + 13) * k, cy);
  });
}

function drawScaleBar(ctx: CanvasRenderingContext2D, rect: RectMm, scale: number, dpi: number): void {
  drawBox(ctx, rect, dpi, { fill: '#ffffff', border: INK, borderMm: 0.4 });
  const k = dpi / 25.4;
  const spec = scaleBarSpec(scale, rect.wMm);
  const segments = 4;

  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(2.8, 700, dpi);
  ctx.fillText(spec.label, (rect.xMm + rect.wMm / 2) * k, (rect.yMm + 2.9) * k);

  // Лінійку центруємо разом із підписом одиниці виміру, а не притискаємо до лівого краю.
  const unit = spec.totalMeters >= 1000 ? 'км' : 'м';
  ctx.font = font(2.2, 400, dpi);
  const unitWidthMm = ctx.measureText(unit).width / k;
  const unitGapMm = 1.6;
  const groupWidthMm = spec.barMm + unitGapMm + unitWidthMm;
  const barX = rect.xMm + Math.max(2, (rect.wMm - groupWidthMm) / 2);
  const barY = rect.yMm + 5.2;
  const barH = 1.6;
  const segW = spec.barMm / segments;

  for (let index = 0; index < segments; index += 1) {
    const seg: RectMm = {
      xMm: barX + segW * index,
      yMm: barY,
      wMm: segW,
      hMm: barH,
    };
    drawBox(ctx, seg, dpi, { fill: index % 2 === 0 ? '#111111' : '#ffffff' });
    const p = toPx(seg, dpi);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.25 * k;
    ctx.strokeRect(p.x, p.y, p.w, p.h);
  }

  ctx.font = font(2.2, 400, dpi);
  ctx.fillStyle = INK;
  for (let index = 0; index <= segments; index += 1) {
    const xMm = barX + segW * index;
    const anchor: CanvasTextAlign = index === 0 ? 'left' : index === segments ? 'right' : 'center';
    ctx.textAlign = anchor;
    ctx.fillText(
      formatDistance(spec.segmentMeters * index, spec.totalMeters),
      xMm * k,
      (barY + barH + 2.2) * k,
    );
  }

  ctx.textAlign = 'left';
  ctx.fillText(unit, (barX + spec.barMm + unitGapMm) * k, (barY + barH / 2) * k);
}

/**
 * Статичний підпис унизу аркуша: «Складено ______ Медичний працівник».
 * Дані маршруту тут навмисно не друкуються.
 */
function drawStamp(ctx: CanvasRenderingContext2D, rect: RectMm, dpi: number): void {
  drawBox(ctx, rect, dpi, { fill: '#ffffff', border: INK, borderMm: 0.4 });
  const k = dpi / 25.4;
  const paddingMm = 3;
  const centerY = (rect.yMm + rect.hMm / 2) * k;

  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.font = font(3, 500, dpi);

  ctx.textAlign = 'left';
  ctx.fillText('Складено', (rect.xMm + paddingMm) * k, centerY);
  const leftWidthMm = ctx.measureText('Складено').width / k;

  ctx.textAlign = 'right';
  ctx.fillText('Медичний працівник', (rect.xMm + rect.wMm - paddingMm) * k, centerY);
  const rightWidthMm = ctx.measureText('Медичний працівник').width / k;

  const lineStart = rect.xMm + paddingMm + leftWidthMm + 2.5;
  const lineEnd = rect.xMm + rect.wMm - paddingMm - rightWidthMm - 2.5;
  if (lineEnd > lineStart) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = (0.35 * dpi) / 25.4;
    ctx.beginPath();
    const lineY = (rect.yMm + rect.hMm * 0.64) * k;
    ctx.moveTo(lineStart * k, lineY);
    ctx.lineTo(lineEnd * k, lineY);
    ctx.stroke();
  }
}

function drawInsetFrame(ctx: CanvasRenderingContext2D, rect: RectMm, caption: string, dpi: number): void {
  const k = dpi / 25.4;
  ctx.strokeStyle = INK;
  ctx.lineWidth = (0.4 * dpi) / 25.4;
  const p = toPx(rect, dpi);
  ctx.strokeRect(p.x, p.y, p.w, p.h);

  if (!caption) return;

  // Розмір шрифту підпису фіксований. Довгий текст переноситься на нові
  // рядки з мінімальним міжрядковим інтервалом, а не зменшується.
  const stripWidthMm = rect.wMm - 3.5;
  const fontSizeMm = 2.7;
  const lineHeightMm = 3;
  const paddingX = 2;
  const paddingY = 1.2;
  ctx.font = font(fontSizeMm, 600, dpi);
  const lines = wrapText(ctx, caption, (stripWidthMm - paddingX * 2) * k, 5);
  if (lines.length === 0) return;

  const stripH = Math.max(6.4, lines.length * lineHeightMm + paddingY * 2);
  const stripMm: RectMm = {
    xMm: rect.xMm + 1,
    yMm: rect.yMm + rect.hMm - stripH - 1,
    wMm: stripWidthMm,
    hMm: stripH,
  };
  drawBox(ctx, stripMm, dpi, { fill: 'rgba(255,255,255,0.94)', border: '#8c8c8c', borderMm: 0.25 });

  ctx.font = font(fontSizeMm, 600, dpi);
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const centerX = (stripMm.xMm + stripMm.wMm / 2) * k;
  lines.forEach((line, index) => {
    const yMm = stripMm.yMm + paddingY + lineHeightMm * (index + 0.5);
    ctx.fillText(line, centerX, yMm * k);
  });
}

/** Малює всі елементи аркуша (без зображень карт). */
export function drawSheet(ctx: CanvasRenderingContext2D, options: SheetDrawOptions): void {
  const { page, layout, visible, texts, scale, dpi, logo, northArrow } = options;

  const frame = mapFrame(page);
  ctx.strokeStyle = INK;
  ctx.lineWidth = (0.4 * dpi) / 25.4;
  const framePx = toPx(frame, dpi);
  ctx.strokeRect(framePx.x, framePx.y, framePx.w, framePx.h);

  if (visible.inset) drawInsetFrame(ctx, layout.inset, texts.facilityCaption, dpi);

  if (visible.header) drawHeader(ctx, layout.header, texts, dpi);

  if (visible.logo && logo) {
    drawImageFit(ctx, logo, layout.logo, dpi, 0);
  }

  if (visible.north && northArrow) {
    drawImageFit(ctx, northArrow, layout.north, dpi, 0);
  }

  if (visible.legend) drawLegend(ctx, layout.legend, dpi);
  if (visible.scaleBar) drawScaleBar(ctx, layout.scaleBar, scale, dpi);
  if (visible.stamp) drawStamp(ctx, layout.stamp, dpi);
}
