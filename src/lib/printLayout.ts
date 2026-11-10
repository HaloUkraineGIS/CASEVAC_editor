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
export type PrintElementId = 'header' | 'logo' | 'north' | 'legend' | 'scaleBar' | 'stamp' | 'inset';

export type PrintLayout = Record<PrintElementId, RectMm>;
export type ElementVisibility = Record<PrintElementId, boolean>;

/** Поля аркуша: на них не заходить основна карта. */
export const PRINT_MARGIN_MM = 6;

/** Масштаби основної карти — кратні 1000, 5000 або 10 000. */
export const MAIN_SCALE_OPTIONS = [5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 100000];

/** Масштаби врізки із закладом — кратні 1000. */
export const INSET_SCALE_OPTIONS = [1000, 2000, 2500, 5000, 10000];

export const DEFAULT_INSET_SCALE = 5000;

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
  return orientation === 'portrait' ? { widthMm: 210, heightMm: 297 } : { widthMm: 297, heightMm: 210 };
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
export function defaultLayout(page: PageMm, scaleDenominator = 25000): PrintLayout {
  const { widthMm: W, heightMm: H } = page;
  const scaleBar = scaleBarSpec(scaleDenominator);

  if (W > H) {
    // Альбомна орієнтація 297 × 210 мм
    return {
      header: { xMm: W / 2 - 66, yMm: 7, wMm: 132, hMm: 17 },
      // Логотип і стрілка півночі зменшені в 1.5 раза проти початкових 26×18 і 12×18
      logo: { xMm: 8, yMm: 7, wMm: 17, hMm: 12 },
      north: { xMm: W - 8 - 8, yMm: 7, wMm: 8, hMm: 12 },
      inset: { xMm: W - 8 - 82, yMm: 32, wMm: 82, hMm: 60 },
      legend: { xMm: 8, yMm: H - 8 - 37, wMm: 66, hMm: 37 },
      scaleBar: {
        xMm: W - 8 - scaleBar.frameWMm,
        yMm: H - 8 - scaleBar.frameHMm,
        wMm: scaleBar.frameWMm,
        hMm: scaleBar.frameHMm,
      },
      // Статичний підпис — один рядок, тому блок нижчий за колишню таблицю.
      stamp: { xMm: W / 2 - 51, yMm: H - 8 - 12, wMm: 102, hMm: 12 },
    };
  }

  // Портретна орієнтація 210 × 297 мм
  return {
    header: { xMm: W / 2 - 66, yMm: 7, wMm: 132, hMm: 17 },
    logo: { xMm: 8, yMm: 7, wMm: 17, hMm: 11 },
    north: { xMm: W - 8 - 8, yMm: 7, wMm: 8, hMm: 11 },
    inset: { xMm: W - 8 - 80, yMm: 30, wMm: 80, hMm: 58 },
    legend: { xMm: 8, yMm: H - 8 - 37, wMm: 66, hMm: 37 },
    scaleBar: {
      xMm: W - 8 - scaleBar.frameWMm,
      yMm: H - 8 - 12 - 3 - scaleBar.frameHMm,
      wMm: scaleBar.frameWMm,
      hMm: scaleBar.frameHMm,
    },
    stamp: { xMm: W - 8 - 102, yMm: H - 8 - 12, wMm: 102, hMm: 12 },
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

export const SCALE_BAR_PADDING_MM = 3;
export const SCALE_BAR_SEGMENTS = 4;
export const SCALE_BAR_TITLE_FONT_MM = 2.6;
export const SCALE_BAR_LABEL_FONT_MM = 2.1;
export const SCALE_BAR_BAR_HEIGHT_MM = 1.7;
export const SCALE_BAR_UNIT_GAP_MM = 1.7;

/** Висота вмісту лінійки без відступів (заголовок + смуга + підписи). */
const SCALE_BAR_CONTENT_HEIGHT_MM =
  2.8 + // заголовок «1:N»
  0.8 + // проміжок до смуги
  SCALE_BAR_BAR_HEIGHT_MM +
  0.8 + // проміжок до підписів
  2.2; // висота рядка підписів

export interface ScaleBarSpec {
  /** Підпис «1:N». */
  label: string;
  /** Загальна довжина лінійки в метрах. */
  totalMeters: number;
  /** Довжина сегмента в метрах. */
  segmentMeters: number;
  /** Довжина лінійки на аркуші в міліметрах. */
  barMm: number;
  /** Одиниця виміру підписів. */
  unit: 'м' | 'км';
  /** Ширина рамки: лінійка з підписами плюс відступ 3 мм з кожного боку. */
  frameWMm: number;
  /** Висота рамки: вміст плюс відступ 3 мм зверху й знизу. */
  frameHMm: number;
}

/** Мантіси «круглих» значень — щоб підписи були зрозумілими. */
const NICE_MANTISSAS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

/** Округлює довжину сегмента до найближчого «круглого» значення. */
function niceSegmentMeters(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 100;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const mantissa = raw / exp;
  const target = mantissa >= 10 ? 10 : mantissa;
  let best = NICE_MANTISSAS[0];
  let bestDiff = Infinity;
  for (const value of NICE_MANTISSAS) {
    const diff = Math.abs(value - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = value;
    }
  }
  return best * exp;
}

/** Приблизна ширина тексту в міліметрах (без canvas). */
function estimateTextWidthMm(text: string, sizeMm: number, weight: number): number {
  return text.length * sizeMm * (weight >= 600 ? 0.62 : 0.58);
}

/**
 * Розрахунок масштабної лінійки.
 *
 * Довжина смуги підбирається незалежно від рамки: спершу обирається «кругла»
 * довжина сегмента, потім рамка будується навколо готової лінійки з відступом
 * 3 мм. Так лінійку більше не звужують під фіксований прямокутник.
 */
export function scaleBarSpec(scaleDenominator: number): ScaleBarSpec {
  const scale = Number.isFinite(scaleDenominator) && scaleDenominator > 0 ? scaleDenominator : 25000;

  // 10 мм на сегмент — орієнтир, за якого підписи ще не злипаються.
  const segmentMeters = niceSegmentMeters(scale / 100);
  const totalMeters = segmentMeters * SCALE_BAR_SEGMENTS;
  const barMm = (totalMeters / scale) * 1000;
  const unit = totalMeters > 1000 ? 'км' : 'м';
  const label = `1:${Math.round(scale).toLocaleString('uk-UA')}`;

  const unitWidthMm = estimateTextWidthMm(unit, SCALE_BAR_LABEL_FONT_MM, 400) + 0.4;
  const titleWidthMm = estimateTextWidthMm(label, SCALE_BAR_TITLE_FONT_MM, 700);
  const contentWidthMm = Math.max(titleWidthMm, barMm + SCALE_BAR_UNIT_GAP_MM + unitWidthMm, barMm);

  return {
    label,
    totalMeters,
    segmentMeters,
    barMm,
    unit,
    frameWMm: contentWidthMm + SCALE_BAR_PADDING_MM * 2,
    frameHMm: SCALE_BAR_CONTENT_HEIGHT_MM + SCALE_BAR_PADDING_MM * 2,
  };
}

/** Зберігає правий нижній кут лінійки, змінюючи її розмір під поточний масштаб. */
export function fitScaleBarRect(rect: RectMm, page: PageMm, scaleDenominator: number): RectMm {
  const spec = scaleBarSpec(scaleDenominator);
  return clampRect(
    {
      xMm: rect.xMm + rect.wMm - spec.frameWMm,
      yMm: rect.yMm + rect.hMm - spec.frameHMm,
      wMm: spec.frameWMm,
      hMm: spec.frameHMm,
    },
    page,
  );
}

/** Людський підпис для випадаючого списку масштабу. */
export function scaleLabel(value: number): string {
  return `1:${value.toLocaleString('uk-UA')}`;
}
