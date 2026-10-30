/**
 * Геометрія аркуша A4 для експорту карти маршруту.
 *
 * Усі розміри — у міліметрах: так аркуш однаково виглядає і в попередньому
 * перегляді (96 dpi), і у PDF (300 dpi). Позиції елементів користувач може
 * змінювати перетягуванням, тому вони зберігаються окремо від налаштувань.
 */

export type Orientation = 'portrait' | 'landscape';

export interface PageMm {
  widthMm: number;
  heightMm: number;
}

export interface RectMm {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

/** Елементи, які малюються поверх карт і можуть перетягуватися. */
export type PrintElementId =
  | 'header'
  | 'logo'
  | 'north'
  | 'legend'
  | 'scaleBar'
  | 'stamp'
  | 'inset';

export type PrintLayout = Record<PrintElementId, RectMm>;
export type ElementVisibility = Record<PrintElementId, boolean>;

/** Поля аркуша: на них не заходить основна карта. */
export const PRINT_MARGIN_MM = 6;

/** Масштаби основної карти — кратні 1000, 5000 або 10 000. */
export const MAIN_SCALE_OPTIONS = [5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 100000];

/** Масштаби врізки із закладом — кратні 1000. */
export const INSET_SCALE_OPTIONS = [1000, 2000, 2500, 5000, 10000];

export const DEFAULT_INSET_SCALE = 2000;

export const ELEMENT_LABELS: Record<PrintElementId, string> = {
  header: 'Шапка',
  logo: 'Логотип',
  north: 'Стрілка півночі',
  legend: 'Легенда',
  scaleBar: 'Масштабна лінійка',
  stamp: 'Таблиця підпису',
  inset: 'Врізка із закладом',
};

/** Усі елементи видимі — початковий стан перемикачів. */
export function allElementsVisible(): ElementVisibility {
  return {
    header: true,
    logo: true,
    north: true,
    legend: true,
    scaleBar: true,
    stamp: true,
    inset: true,
  };
}

export function a4Page(orientation: Orientation): PageMm {
  return orientation === 'portrait'
    ? { widthMm: 210, heightMm: 297 }
    : { widthMm: 297, heightMm: 210 };
}

/** Ділянка основної карти (аркуш без полів). */
export function mapFrame(page: PageMm): RectMm {
  return {
    xMm: PRINT_MARGIN_MM,
    yMm: PRINT_MARGIN_MM,
    wMm: page.widthMm - PRINT_MARGIN_MM * 2,
    hMm: page.heightMm - PRINT_MARGIN_MM * 2,
  };
}

/**
 * Підбирає «круглий» масштаб, кратний 1000 (до 1:5000), 5000 (до 1:20 000)
 * або 10 000 — щоб на аркуші стояв типовий масштаб карти.
 */
export function niceScale(required: number): number {
  if (!Number.isFinite(required) || required <= 0) return 5000;
  const step = required <= 5000 ? 1000 : required <= 20000 ? 5000 : 10000;
  return Math.max(step, Math.ceil(required / step) * step);
}

/**
 * Початкове розташування елементів на аркуші.
 * Позиції підібрані так, щоб елементи не перекривалися в обох орієнтаціях.
 */
export function defaultLayout(page: PageMm): PrintLayout {
  const { widthMm: W, heightMm: H } = page;

  if (W > H) {
    // Альбомна орієнтація 297 × 210 мм
    return {
      header: { xMm: W / 2 - 66, yMm: 7, wMm: 132, hMm: 17 },
      logo: { xMm: 8, yMm: 7, wMm: 26, hMm: 18 },
      north: { xMm: W - 8 - 12, yMm: 7, wMm: 12, hMm: 18 },
      inset: { xMm: W - 8 - 82, yMm: 32, wMm: 82, hMm: 60 },
      legend: { xMm: 8, yMm: H - 8 - 37, wMm: 66, hMm: 37 },
      scaleBar: { xMm: W - 8 - 40, yMm: H - 8 - 15, wMm: 40, hMm: 15 },
      stamp: { xMm: W / 2 - 51, yMm: H - 8 - 19, wMm: 102, hMm: 19 },
    };
  }

  // Портретна орієнтація 210 × 297 мм
  return {
    header: { xMm: W / 2 - 66, yMm: 7, wMm: 132, hMm: 17 },
    logo: { xMm: 8, yMm: 7, wMm: 25, hMm: 17 },
    north: { xMm: W - 8 - 12, yMm: 7, wMm: 12, hMm: 17 },
    inset: { xMm: W - 8 - 80, yMm: 30, wMm: 80, hMm: 58 },
    legend: { xMm: 8, yMm: H - 8 - 37, wMm: 66, hMm: 37 },
    scaleBar: { xMm: W - 8 - 40, yMm: H - 8 - 19 - 15 - 3, wMm: 40, hMm: 15 },
    stamp: { xMm: W - 8 - 102, yMm: H - 8 - 19, wMm: 102, hMm: 19 },
  };
}

/** Обмежує прямокутник межами аркуша (під час перетягування). */
export function clampRect(rect: RectMm, page: PageMm): RectMm {
  return {
    ...rect,
    xMm: Math.min(Math.max(0, rect.xMm), Math.max(0, page.widthMm - rect.wMm)),
    yMm: Math.min(Math.max(0, rect.yMm), Math.max(0, page.heightMm - rect.hMm)),
  };
}

export interface ScaleBarSpec {
  /** Підпис «1:N». */
  label: string;
  /** Загальна довжина лінійки в метрах. */
  totalMeters: number;
  /** Довжина сегмента в метрах. */
  segmentMeters: number;
  /** Довжина лінійки на аркуші в міліметрах. */
  barMm: number;
}

/** Округлює довжину лінійки до 1 / 2 / 5 · 10ⁿ метрів. */
function niceMeters(raw: number): number {
  const exp = 10 ** Math.floor(Math.log10(raw));
  const mantissa = raw / exp;
  const snap = mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10;
  return snap * exp;
}

/** Розрахунок масштабної лінійки під задану ширину блока на аркуші. */
export function scaleBarSpec(scaleDenominator: number, availableMm: number): ScaleBarSpec {
  const targetMm = Math.max(12, availableMm - 18);
  const totalMeters = niceMeters((targetMm / 1000) * scaleDenominator);
  return {
    label: `1:${Math.round(scaleDenominator).toLocaleString('uk-UA')}`,
    totalMeters,
    segmentMeters: totalMeters / 4,
    barMm: (totalMeters / scaleDenominator) * 1000,
  };
}

/** Людський підпис для випадаючого списку масштабу. */
export function scaleLabel(value: number): string {
  return `1:${value.toLocaleString('uk-UA')}`;
}
