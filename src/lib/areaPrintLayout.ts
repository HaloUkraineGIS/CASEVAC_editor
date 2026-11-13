/**
 * Геометрія аркуша A3 для експорту карти області.
 *
 * На відміну від A4-карти маршруту, тут немає врізки: усі елементи лежать
 * безпосередньо на карті. Налаштування цього аркуша не використовуються
 * іншими сторінками й не змінюють їхні карти.
 */

import {
  scaleBarSpec,
  type Orientation,
  type PageMm,
  type RectMm,
} from './printLayout';

/** Поля аркуша A3: на них не заходить карта. */
export const AREA_PRINT_MARGIN_MM = 8;

export type AreaElementId = 'header' | 'logo' | 'north' | 'legend' | 'scaleBar' | 'stamp';

export type AreaLayout = Record<AreaElementId, RectMm>;

/** Масштаби, типові для оглядової карти області. */
export const AREA_SCALE_OPTIONS = [
  50000, 100000, 150000, 200000, 250000, 300000, 400000, 500000, 750000, 1000000,
];

/** Мінімальний автоматичний масштаб, щоб один заклад не «прилипав» до міста. */
export const AREA_MIN_AUTO_SCALE = 250000;

/** A3: 420 × 297 мм альбомна, 297 × 420 мм портретна. */
export function a3Page(orientation: Orientation): PageMm {
  return orientation === 'portrait'
    ? { widthMm: 297, heightMm: 420 }
    : { widthMm: 420, heightMm: 297 };
}

/** Ділянка карти — увесь аркуш без полів. */
export function areaMapFrame(page: PageMm): RectMm {
  return {
    xMm: AREA_PRINT_MARGIN_MM,
    yMm: AREA_PRINT_MARGIN_MM,
    wMm: page.widthMm - AREA_PRINT_MARGIN_MM * 2,
    hMm: page.heightMm - AREA_PRINT_MARGIN_MM * 2,
  };
}

/** Висота рамки легенди залежно від кількості рядків. */
function legendHeightMm(rows: number): number {
  return 9 + Math.max(1, Math.min(rows, 8)) * 6.4 + 3;
}

/**
 * Початкове розташування елементів A3.
 *
 * Логотип — верхній лівий кут, назва — по центру верху, стрілка півночі —
 * верхній правий кут, легенда — нижній правий, масштабна лінійка — нижній
 * центр, блок «Погоджено» — нижній лівий кут.
 */
export function areaDefaultLayout(
  page: PageMm,
  legendRows = 1,
  scaleDenominator = AREA_MIN_AUTO_SCALE,
): AreaLayout {
  const { widthMm: W, heightMm: H } = page;
  const landscape = W > H;
  const margin = AREA_PRINT_MARGIN_MM;
  const scaleBar = scaleBarSpec(scaleDenominator);

  const headerW = landscape ? 280 : 200;
  const headerH = 22;
  const logoW = landscape ? 34 : 30;
  const logoH = 22;
  const northW = 22;
  const northH = 30;
  const legendW = landscape ? 82 : 80;
  const legendH = legendHeightMm(legendRows);
  const stampW = landscape ? 150 : 105;
  const stampH = 16;

  return {
    header: { xMm: W / 2 - headerW / 2, yMm: margin, wMm: headerW, hMm: headerH },
    logo: { xMm: margin, yMm: margin, wMm: logoW, hMm: logoH },
    north: { xMm: W - margin - northW, yMm: margin, wMm: northW, hMm: northH },
    legend: { xMm: W - margin - legendW, yMm: H - margin - legendH, wMm: legendW, hMm: legendH },
    scaleBar: {
      xMm: W / 2 - scaleBar.frameWMm / 2,
      yMm: H - margin - scaleBar.frameHMm,
      wMm: scaleBar.frameWMm,
      hMm: scaleBar.frameHMm,
    },
    stamp: { xMm: margin, yMm: H - margin - stampH, wMm: stampW, hMm: stampH },
  };
}

const GENITIVE_OVERRIDES: Record<string, string> = {
  Крим: 'Криму',
  'АР Крим': 'АР Криму',
  Севастополь: 'Севастополя',
  Київ: 'Києва',
};

/** Чи це назва, до якої не додається слово «області». */
const NON_OBLAST_REGIONS = new Set(['Крим', 'АР Крим', 'Севастополь', 'Київ']);

/**
 * Родовий відмінок назви області: «Київська» → «Київської».
 *
 * Значення поля «Область» у шарі — прикметник («Київська», «Львівська»),
 * тому для заголовка його треба відмінювати. Якщо значення вже містить
 * слово «область», воно замінюється на «області».
 */
export function regionGenitive(region: string): string {
  const base = region.trim().replace(/\s+/g, ' ');
  if (!base) return '';
  if (/області$/i.test(base)) return base;

  const hasOblast = /область$/i.test(base);
  const withoutOblast = base.replace(/\s*область$/i, '').trim();
  const override = GENITIVE_OVERRIDES[withoutOblast];
  if (override) return hasOblast ? `${override} області` : override;

  const genitive = /[ая]$/u.test(withoutOblast)
    ? `${withoutOblast.slice(0, -1)}ої`
    : withoutOblast;
  return hasOblast ? `${genitive} області` : genitive;
}

/**
 * Заголовок аркуша: «Медичні заклади Київської області».
 *
 * Для назв без слова «область» (Крим, Київ) додаток не використовується.
 */
export function areaFacilitiesTitle(region: string): string {
  const base = region.trim().replace(/\s+/g, ' ');
  if (!base) return 'Медичні заклади';

  const withoutOblast = base.replace(/\s*область$/i, '').trim();
  const genitive = regionGenitive(base);
  if (!genitive) return 'Медичні заклади';
  if (/області$/i.test(genitive)) return `Медичні заклади ${genitive}`;
  if (NON_OBLAST_REGIONS.has(withoutOblast)) return `Медичні заклади ${genitive}`;
  return `Медичні заклади ${genitive} області`;
}
