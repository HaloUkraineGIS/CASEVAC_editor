/**
 * Малювання аркуша експорту на canvas.
 *
 * Один і той самий код малює і попередній перегляд (96 dpi), і фінальний PDF
 * (300 dpi): різниця лише в `dpi`, тому попередній перегляд відповідає друку.
 * Карти (основна та врізка) малюються окремо — їх дають знімки ArcGIS MapView.
 */

import {
  mapFrame,
  SCALE_BAR_BAR_HEIGHT_MM,
  SCALE_BAR_LABEL_FONT_MM,
  SCALE_BAR_PADDING_MM,
  SCALE_BAR_SEGMENTS,
  SCALE_BAR_TITLE_FONT_MM,
  SCALE_BAR_UNIT_GAP_MM,
  scaleBarSpec,
  type ElementVisibility,
  type PageMm,
  type PrintLayout,
  type RectMm,
} from './printLayout';
import { areaMapFrame, type AreaLayout } from './areaPrintLayout';

export interface SheetTexts {
  /** Перший рядок шапки, наприклад «CASEVAC 12.5 км». */
  heading: string;
  /** Другий рядок шапки — ділянка розмінування. */
  subheading: string;
  /** Підпис врізки: адреса або назва закладу. */
  facilityCaption: string;
}

/** Позначки точкових об'єктів для легенди (зображення з шарів карти). */
export interface LegendSymbols {
  facility?: CanvasImageSource | null;
  start?: CanvasImageSource | null;
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
  /** Символи точок для легенди; без них малюються стандартні позначки. */
  legendSymbols?: LegendSymbols;
}

const FONT_FAMILY = "'DM Sans', 'Segoe UI', Arial, sans-serif";
const INK = '#111111';
const FACILITY_BLUE = '#2d6fbf';
const ROUTE_RED = '#e53935';

/** Товщина контурів елементів A3-аркуша області (рамка, шапка, легенда, блок підпису). */
const AREA_LINE_MM = 0.4;

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
  if (totalMeters > 1000) {
    const km = meters / 1000;
    if (Number.isInteger(km)) return String(km);
    // До двох знаків після коми, без зайвих нулів: 0,25 / 0,5 / 1,25.
    const text = km
      .toFixed(2)
      .replace(/\.?0+$/, '')
      .replace('.', ',');
    return text;
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

/** Малює зображення символу по центру позначки легенди. */
function drawLegendImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  centerX: number,
  centerY: number,
  sizeMm: number,
  dpi: number,
): void {
  const natural = imageSize(image);
  if (!natural) return;
  const k = dpi / 25.4;
  const box = sizeMm * k;
  const ratio = Math.min(box / natural.width, box / natural.height);
  const width = natural.width * ratio;
  const height = natural.height * ratio;
  ctx.drawImage(image, centerX - width / 2, centerY - height / 2, width, height);
}

/** Стандартна позначка закладу, якщо символ шару недоступний. */
function drawFallbackFacilityMark(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  k: number,
  dpi: number,
  withLetter = true,
): void {
  ctx.beginPath();
  ctx.arc(centerX, centerY, 2.4 * k, 0, Math.PI * 2);
  ctx.fillStyle = FACILITY_BLUE;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.45 * k;
  ctx.stroke();
  if (withLetter) {
    ctx.fillStyle = '#ffffff';
    ctx.font = font(2.6, 700, dpi);
    ctx.textAlign = 'center';
    ctx.fillText('H', centerX, centerY + 0.1 * k);
    ctx.textAlign = 'left';
  }
}

function drawLegend(ctx: CanvasRenderingContext2D, rect: RectMm, dpi: number, symbols?: LegendSymbols): void {
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
      if (symbols?.facility) {
        drawLegendImage(ctx, symbols.facility, centerX, cy, 5.6, dpi);
      } else {
        drawFallbackFacilityMark(ctx, centerX, cy, k, dpi);
      }
    } else if (row.kind === 'start') {
      if (symbols?.start) {
        drawLegendImage(ctx, symbols.start, centerX, cy, 3.6, dpi);
      } else {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.6 * k;
        ctx.beginPath();
        ctx.moveTo(centerX - 2.2 * k, cy);
        ctx.lineTo(centerX + 2.2 * k, cy);
        ctx.moveTo(centerX, cy - 2.2 * k);
        ctx.lineTo(centerX, cy + 2.2 * k);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = ROUTE_RED;
      ctx.lineWidth = 0.65 * k;
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
  const spec = scaleBarSpec(scale);
  const paddingMm = SCALE_BAR_PADDING_MM;
  const contentX = rect.xMm + paddingMm;
  const contentW = Math.max(1, rect.wMm - paddingMm * 2);

  // Вертикальна розкладка вмісту (див. SCALE_BAR_CONTENT_HEIGHT_MM).
  const titleBlockMm = 2.8;
  const titleGapMm = 0.8;
  const barToLabelGapMm = 0.8;
  const labelBlockMm = 2.2;

  // Заголовок «1:N» — по центру рамки.
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const titleSize = fitFont(ctx, spec.label, contentW * k, SCALE_BAR_TITLE_FONT_MM, 700, dpi, 1.9);
  ctx.font = font(titleSize, 700, dpi);
  const titleCenterY = rect.yMm + paddingMm + titleBlockMm / 2;
  ctx.fillText(spec.label, (rect.xMm + rect.wMm / 2) * k, titleCenterY * k);

  // Смугу центруємо разом із підписом одиниці виміру.
  ctx.font = font(SCALE_BAR_LABEL_FONT_MM, 400, dpi);
  const unitWidthMm = ctx.measureText(spec.unit).width / k;
  const groupWidthMm = spec.barMm + SCALE_BAR_UNIT_GAP_MM + unitWidthMm;
  const barX = contentX + Math.max(0, (contentW - groupWidthMm) / 2);
  const barY = rect.yMm + paddingMm + titleBlockMm + titleGapMm;
  const barH = SCALE_BAR_BAR_HEIGHT_MM;
  const segW = spec.barMm / SCALE_BAR_SEGMENTS;

  for (let index = 0; index < SCALE_BAR_SEGMENTS; index += 1) {
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

  // Підписи під лінійкою. Якщо сусідні підписи починають перекриватися,
  // спершу трохи зменшуємо шрифт, а далі лишаємо кожен другий поділ.
  const labelText = (index: number) => formatDistance(spec.segmentMeters * index, spec.totalMeters);
  let visibleTicks = Array.from({ length: SCALE_BAR_SEGMENTS + 1 }, (_, index) => index);
  let labelFontMm = SCALE_BAR_LABEL_FONT_MM;

  for (;;) {
    ctx.font = font(labelFontMm, 400, dpi);
    const widths = visibleTicks.map((index) => ctx.measureText(labelText(index)).width / k);
    const overlaps = visibleTicks.some((index, position) => {
      if (position === 0) return false;
      const previous = visibleTicks[position - 1];
      const neededMm = (widths[position - 1] + widths[position]) / 2 + 0.9;
      return segW * (index - previous) < neededMm;
    });

    if (!overlaps) break;

    if (labelFontMm > 1.7 + 0.001) {
      labelFontMm = Math.max(1.7, labelFontMm - 0.1);
      continue;
    }

    const reduced = visibleTicks.filter(
      (_, position) => position === 0 || position === visibleTicks.length - 1 || position % 2 === 0,
    );
    if (reduced.length === visibleTicks.length) break;
    visibleTicks = reduced;
  }

  ctx.font = font(labelFontMm, 400, dpi);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  const labelCenterY = barY + barH + barToLabelGapMm + labelBlockMm / 2;

  visibleTicks.forEach((index) => {
    const anchor: CanvasTextAlign = index === 0 ? 'left' : index === SCALE_BAR_SEGMENTS ? 'right' : 'center';
    ctx.textAlign = anchor;
    ctx.fillText(labelText(index), (barX + segW * index) * k, labelCenterY * k);
  });

  // Одиниця виміру — праворуч від смуги, по її центру.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.unit, (barX + spec.barMm + SCALE_BAR_UNIT_GAP_MM) * k, (barY + barH / 2) * k);
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

  if (visible.legend) drawLegend(ctx, layout.legend, dpi, options.legendSymbols);
  if (visible.scaleBar) drawScaleBar(ctx, layout.scaleBar, scale, dpi);
  if (visible.stamp) drawStamp(ctx, layout.stamp, dpi);
}

/** Рядок легенди A3-карти області. */
export interface AreaLegendRow {
  label: string;
  image?: CanvasImageSource | null;
}

export interface AreaSheetDrawOptions {
  page: PageMm;
  layout: AreaLayout;
  /** Заголовок у верхньому блоці, наприклад «Медичні заклади Київської області». */
  title: string;
  /** Масштаб карти (знаменник). */
  scale: number;
  dpi: number;
  logo?: CanvasImageSource | null;
  northArrow?: CanvasImageSource | null;
  /** Умовні позначення лише шару медичних закладів. */
  legendRows: AreaLegendRow[];
}

function drawAreaHeader(
  ctx: CanvasRenderingContext2D,
  rect: RectMm,
  title: string,
  dpi: number,
): void {
  drawBox(ctx, rect, dpi, { fill: '#ffffff', border: INK, borderMm: AREA_LINE_MM });
  const k = dpi / 25.4;
  const maxWidth = (rect.wMm - 8) * k;
  const size = fitFont(ctx, title, maxWidth, 5.6, 700, dpi, 2.8);

  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(size, 700, dpi);
  ctx.fillText(title, (rect.xMm + rect.wMm / 2) * k, (rect.yMm + rect.hMm / 2) * k);
}

function drawAreaLegend(
  ctx: CanvasRenderingContext2D,
  rect: RectMm,
  rows: AreaLegendRow[],
  dpi: number,
): void {
  drawBox(ctx, rect, dpi, { fill: '#ffffff', border: INK, borderMm: AREA_LINE_MM });
  const k = dpi / 25.4;
  const left = (rect.xMm + 3) * k;

  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(3.1, 700, dpi);
  ctx.fillText('Умовні позначення', left, (rect.yMm + 5) * k);

  if (rows.length === 0) {
    ctx.fillStyle = INK;
    ctx.font = font(2.6, 400, dpi);
    ctx.fillText('Немає даних', left, (rect.yMm + 12) * k);
    return;
  }

  const visibleRows = rows.slice(0, 8);
  const rowH = Math.max(4.8, (rect.hMm - 10) / visibleRows.length);
  const markerX = (rect.xMm + 9) * k;
  const labelLeft = (rect.xMm + 15.5) * k;
  const labelMaxWidth = Math.max(1, (rect.wMm - 17) * k);

  visibleRows.forEach((row, index) => {
    const cyMm = rect.yMm + 9 + rowH * index + rowH / 2;
    const cy = cyMm * k;

    // Малюємо лише реальний символ шару. Якщо його не вдалося відтворити,
    // не підставляємо довільний маркер — краще порожнє місце, ніж неправда.
    if (row.image) {
      drawLegendImage(ctx, row.image, markerX, cy, 5.8, dpi);
    }

    const size = fitFont(ctx, row.label, labelMaxWidth, 2.8, 500, dpi, 1.8);
    ctx.fillStyle = INK;
    ctx.font = font(size, 500, dpi);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.label, labelLeft, cy);
  });
}

/**
 * Блок «Погоджено ________ Медичний працівник» у нижньому лівому куті.
 *
 * Статичний блок для паперового підпису: текст стоїть нижче середини блоку,
 * щоб над рискою лишилося місце для підпису після друку.
 */
function drawAreaApproval(ctx: CanvasRenderingContext2D, rect: RectMm, dpi: number): void {
  drawBox(ctx, rect, dpi, { fill: '#ffffff', border: INK, borderMm: AREA_LINE_MM });
  const k = dpi / 25.4;
  const first = 'Погоджено';
  const second = 'Медичний працівник';
  const pad = 3.5;
  const gap = 4;
  const minLine = 18;
  const textY = (rect.yMm + rect.hMm * 0.68) * k;

  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  let size = 3.2;
  let w1 = 0;
  let w2 = 0;
  let lineLen = minLine;
  for (;;) {
    ctx.font = font(size, 500, dpi);
    w1 = ctx.measureText(first).width / k;
    w2 = ctx.measureText(second).width / k;
    const avail = rect.wMm - pad * 2 - w1 - w2 - gap * 2;
    if (avail >= minLine || size <= 2.2) {
      lineLen = Math.max(8, avail);
      break;
    }
    size = Math.max(2.2, size - 0.2);
  }

  ctx.font = font(size, 500, dpi);
  const leftMm = rect.xMm + pad;
  ctx.fillText(first, leftMm * k, textY);

  const lineStartMm = leftMm + w1 + gap;
  const lineEndMm = lineStartMm + lineLen;
  ctx.strokeStyle = INK;
  ctx.lineWidth = (AREA_LINE_MM * dpi) / 25.4;
  ctx.beginPath();
  ctx.moveTo(lineStartMm * k, textY + 1.1 * k);
  ctx.lineTo(lineEndMm * k, textY + 1.1 * k);
  ctx.stroke();

  ctx.fillText(second, (lineEndMm + gap) * k, textY);
}

/**
 * Малює A3-аркуш області: карта вже намальована під цим полотном, функція
 * додає лише рамку та елементи оформлення. Легенда містить тільки шар
 * медичних закладів — підкладка в неї не додається.
 */
export function drawAreaSheet(ctx: CanvasRenderingContext2D, options: AreaSheetDrawOptions): void {
  const { page, layout, title, scale, dpi, logo, northArrow, legendRows } = options;

  const frame = areaMapFrame(page);
  const framePx = toPx(frame, dpi);
  ctx.strokeStyle = INK;
  ctx.lineWidth = (AREA_LINE_MM * dpi) / 25.4;
  ctx.strokeRect(framePx.x, framePx.y, framePx.w, framePx.h);

  drawAreaHeader(ctx, layout.header, title, dpi);

  if (logo) drawImageFit(ctx, logo, layout.logo, dpi, 0);
  if (northArrow) drawImageFit(ctx, northArrow, layout.north, dpi, 0);

  drawAreaLegend(ctx, layout.legend, legendRows, dpi);
  drawScaleBar(ctx, layout.scaleBar, scale, dpi);
  drawAreaApproval(ctx, layout.stamp, dpi);
}

