/**
 * Карта для A3-аркуша «План реагування на область».
 *
 * У режимі Portal карта будується з тієї самої веб-карти, що й оглядова карта
 * закладів, але підкладка не замінюється: на аркуші має бути
 * `Ukraine_OSM_Basemap_lite`, налаштована у веб-карті. Усі шари, крім
 * «Медичні заклади», ховаються, а сам шар фільтрується за OBJECTID
 * відфільтрованих закладів.
 *
 * У демо-режимі (без токена Portal) використовується OpenStreetMap і графіка
 * закладів застосунку — це єдиний доступний варіант без авторизації.
 */

import Graphic from '@arcgis/core/Graphic.js';
import Point from '@arcgis/core/geometry/Point.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import type Layer from '@arcgis/core/layers/Layer.js';
import type Sublayer from '@arcgis/core/layers/support/Sublayer.js';
import Map from '@arcgis/core/Map.js';
import type { SymbolUnion } from '@arcgis/core/symbols/types.js';
import MapView from '@arcgis/core/views/MapView.js';
import WebMap from '@arcgis/core/WebMap.js';
import { appConfig } from '../config/appConfig';
import { AREA_MIN_AUTO_SCALE } from './areaPrintLayout';
import { FACILITY_STALE_SYMBOL, FACILITY_VERIFIED_SYMBOL } from './facilitySymbols';
import { isVisitStale } from './format';
import { autoScaleFor, geometryCenter } from './printMap';
import {
  legendFromRenderer,
  resolveLayerLegendFromService,
  resolveServicePointSymbol,
} from './layerSymbols';
import {
  findMedicalTarget,
  isolateMedicalLayers,
  type MedicalTarget,
} from './medicalLayers';
import { createOsmBasemap } from './osmBasemap';
import { registerPortalToken } from './portalToken';
import { symbolPreviewImage } from './symbolImages';
import type { FacilityRecord, LonLat } from '../types';

export type AreaMapMode = 'webmap' | 'fallback';

export interface AreaMapHandle {
  view: MapView;
  mode: AreaMapMode;
  /** Підпис підкладки для панелі налаштувань. */
  basemapTitle: string;
  /** Шар медичних закладів у режимі Portal (для легенди). */
  facilityLayer: Layer | Sublayer | null;
  /** Пояснення, якщо довелося перейти на демо-підкладку. */
  notice: string;
}

export interface AreaSheetViewOptions {
  facilities: FacilityRecord[];
  token: string | null;
  expiresAt: number;
  center: LonLat;
  scale: number;
  /** Перевірка скасування, щоб не створювати карту після закриття модалки. */
  isCancelled?: () => boolean;
}

export interface AreaLegendRowData {
  label: string;
  image: HTMLImageElement | null;
}

export interface AreaLegendResult {
  rows: AreaLegendRowData[];
  /** Звідки взято позначки — показуємо в панелі налаштувань. */
  source: string;
}

const WEBMAP_TIMEOUT_MS = 15000;
const VIEW_TIMEOUT_MS = 15000;

/** Кеш зображень позначок: на кожен рух карти легенду не перемальовуємо з нуля. */
const previewCache = new globalThis.Map<string, Promise<HTMLImageElement | null>>();

function cachedSymbolPreview(key: string, symbol: SymbolUnion): Promise<HTMLImageElement | null> {
  const cached = previewCache.get(key);
  if (cached) return cached;
  const request = symbolPreviewImage(symbol);
  previewCache.set(key, request);
  return request;
}

function previewKey(label: string, symbol: SymbolUnion): string {
  try {
    return `${label} ${JSON.stringify(symbol.toJSON())}`;
  } catch {
    return label;
  }
}

/**
 * Заклади, які зараз потрапляють у кадр карти.
 *
 * Перевірка йде через екранні координати (`view.toScreen`), тому працює за
 * будь-якої просторової прив'язки підкладки. Якщо кадр визначити не вдалося —
 * повертаємо весь список, щоб легенда не спорожніла через технічну помилку.
 */
export function facilitiesInExtent(
  view: MapView,
  facilities: FacilityRecord[],
): FacilityRecord[] {
  try {
    const width = view.width;
    const height = view.height;
    if (!width || !height) return facilities;
    return facilities.filter((facility) => {
      if (!facility.location) return false;
      const screen = view.toScreen(
        new Point({ longitude: facility.location[0], latitude: facility.location[1] }),
      );
      if (!screen) return true;
      return screen.x >= 0 && screen.y >= 0 && screen.x <= width && screen.y <= height;
    });
  } catch {
    return facilities;
  }
}

/** Чи це символ «заклад потребує оновлення» (жовто-коричневий кружок). */
function isStaleFacilitySymbol(symbol: SymbolUnion): boolean {
  const color = (symbol as { color?: { toHex?: () => string } }).color;
  return color?.toHex?.().toLowerCase() === '#d6a352';
}

function facilityLegendLabel(symbol: SymbolUnion): string {
  return isStaleFacilitySymbol(symbol) ? 'Потребує оновлення' : 'Медичні заклади';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

/** Фільтрує шар веб-карти лише за вибраними медичними закладами. */
function applyFacilityFilter(target: MedicalTarget, facilities: FacilityRecord[]): void {
  const ids = facilities
    .map((facility) => facility.objectId)
    .filter((id): id is number => typeof id === 'number');
  const idExpression = ids.length > 0 ? `${target.objectIdField} IN (${ids.join(',')})` : '1=0';
  const expression = target.baseExpression
    ? `(${target.baseExpression}) AND (${idExpression})`
    : idExpression;
  const holder = target.layer as unknown as { definitionExpression?: string };
  if (holder.definitionExpression !== expression) {
    holder.definitionExpression = expression;
  }
}

/** Фіксує масштаб: колесо та подвійний клік не змінюють його, панування лишається. */
function lockScale(view: MapView): void {
  view.on('mouse-wheel', (event: { stopPropagation: () => void }) => event.stopPropagation());
  view.on('double-click', (event: { stopPropagation: () => void }) => event.stopPropagation());
}

function fallbackGraphics(facilities: FacilityRecord[]): Graphic[] {
  return facilities
    .filter((facility) => facility.location)
    .map(
      (facility) =>
        new Graphic({
          geometry: {
            type: 'point',
            longitude: facility.location![0],
            latitude: facility.location![1],
          },
          symbol: isVisitStale(facility.lastVisitDate)
            ? FACILITY_STALE_SYMBOL
            : FACILITY_VERIFIED_SYMBOL,
        }),
    );
}

/**
 * Створює MapView для A3-аркуша.
 *
 * Повертає `null`, якщо модалку вже закрили під час завантаження карти.
 */
export async function createAreaSheetView(
  container: HTMLDivElement,
  options: AreaSheetViewOptions,
): Promise<AreaMapHandle | null> {
  const cancelled = () => options.isCancelled?.() === true;
  let view: MapView | null = null;
  let webmap: WebMap | null = null;
  let notice = '';

  if (options.token) {
    try {
      registerPortalToken(options.token, options.expiresAt);
      webmap = new WebMap({ portalItem: { id: appConfig.webMapId } });
      const loaded = await withTimeout(webmap.load(), WEBMAP_TIMEOUT_MS);
      if (cancelled()) {
        webmap.destroy();
        return null;
      }
      if (!loaded) throw new Error('Portal не відповів на запит веб-карти');

      const hasTarget = isolateMedicalLayers(webmap.layers);
      if (!hasTarget) throw new Error('У веб-карті не знайдено шар медичних закладів');
      const target = findMedicalTarget(webmap.layers);
      if (!target) throw new Error('Не вдалося визначити шар медичних закладів');
      if (!webmap.basemap) throw new Error('У веб-карті немає підкладки');

      applyFacilityFilter(target, options.facilities);

      view = new MapView({
        container,
        map: webmap,
        center: options.center,
        scale: options.scale,
        constraints: { rotationEnabled: false, snapToZoom: false },
        popupEnabled: false,
        ui: { components: [] },
        attributionVisible: false,
      });

      const ready = await withTimeout(view.when(), VIEW_TIMEOUT_MS);
      if (cancelled()) {
        view.destroy();
        webmap.destroy();
        return null;
      }
      if (!ready) throw new Error('Карта не встигла завантажитися');

      lockScale(view);
      return {
        view,
        mode: 'webmap',
        basemapTitle: webmap.basemap.title || 'Ukraine_OSM_Basemap_lite',
        facilityLayer: target.layer,
        notice: '',
      };
    } catch (error) {
      view?.destroy();
      webmap?.destroy();
      view = null;
      webmap = null;
      if (cancelled()) return null;
      const reason = error instanceof Error ? error.message : 'невідома помилка';
      notice = `Веб-карта Portal недоступна (${reason}). Показано OpenStreetMap.`;
    }
  } else {
    notice = 'Демо-режим: веб-карта Portal потребує входу. Показано OpenStreetMap.';
  }

  const map = new Map({ basemap: createOsmBasemap() });
  const graphics = new GraphicsLayer({
    listMode: 'hide',
    graphics: fallbackGraphics(options.facilities),
  });
  map.add(graphics);

  view = new MapView({
    container,
    map,
    center: options.center,
    scale: options.scale,
    constraints: { rotationEnabled: false, snapToZoom: false },
    popupEnabled: false,
    ui: { components: [] },
    attributionVisible: false,
  });

  const ready = await withTimeout(view.when(), VIEW_TIMEOUT_MS);
  if (cancelled()) {
    view.destroy();
    return null;
  }
  if (!ready) {
    view.destroy();
    throw new Error('Не вдалося завантажити карту області');
  }

  lockScale(view);
  return {
    view,
    mode: 'fallback',
    basemapTitle: 'OpenStreetMap (демо)',
    facilityLayer: null,
    notice,
  };
}

/**
 * Символи, якими реально намальовані заклади на демо-карті (GraphicsLayer),
 * — лише ті, що зараз потрапляють у кадр.
 */
async function rowsFromMapGraphics(handle: AreaMapHandle): Promise<AreaLegendRowData[]> {
  const rows: AreaLegendRowData[] = [];
  const seen = new Set<string>();

  const inFrame = (longitude: number, latitude: number): boolean => {
    try {
      const width = handle.view.width;
      const height = handle.view.height;
      if (!width || !height) return true;
      const screen = handle.view.toScreen(new Point({ longitude, latitude }));
      if (!screen) return true;
      return screen.x >= 0 && screen.y >= 0 && screen.x <= width && screen.y <= height;
    } catch {
      return true;
    }
  };

  for (const layer of handle.view.map?.layers?.toArray() ?? []) {
    if (layer.type !== 'graphics') continue;
    for (const graphic of (layer as GraphicsLayer).graphics.toArray()) {
      const symbol = graphic.symbol as SymbolUnion | null;
      if (!symbol) continue;
      const geometry = graphic.geometry as unknown as {
        longitude?: number;
        latitude?: number;
      } | null;
      if (
        typeof geometry?.longitude === 'number' &&
        typeof geometry?.latitude === 'number' &&
        !inFrame(geometry.longitude, geometry.latitude)
      ) {
        continue;
      }

      const label = facilityLegendLabel(symbol);
      const key = previewKey(label, symbol);
      if (seen.has(key)) continue;
      seen.add(key);

      const image = await cachedSymbolPreview(key, symbol);
      if (image) rows.push({ label, image });
    }
  }

  return rows;
}

/**
 * Легенда A3-аркуша: лише умовні позначення об'єктів, які зараз видно в кадрі.
 * Підкладка у легенду не додається.
 *
 * Порядок джерел:
 * 1. демо-карта — символи графіки, яка реально намальована в кадрі;
 * 2. Portal — класи рендерера шару веб-карти, відфільтровані за атрибутами
 *    закладів у кадрі;
 * 3. `drawingInfo.renderer` сервісу, який малює шар, з тією самою фільтрацією;
 * 4. резервний символ застосунку (лише якщо нічого не вдалося прочитати).
 */
export async function buildAreaLegendRows(
  handle: AreaMapHandle,
  token: string | null,
  facilities: FacilityRecord[] = [],
): Promise<AreaLegendResult> {
  // Легенда показує тільки знаки об'єктів у кадрі, а не всі класи шару.
  const visible = facilitiesInExtent(handle.view, facilities);
  const attributesList = visible.map((facility) => facility.attributes);
  const frameNote = `у кадрі ${visible.length} з ${facilities.length}`;
  if (visible.length === 0) {
    // У кадрі немає жодного закладу — краще порожня легенда («Немає даних»),
    // ніж узагальнений знак, якого немає на карті.
    return { rows: [], source: 'у кадрі немає закладів' };
  }
  if (handle.mode === 'fallback') {
    const fromGraphics = await rowsFromMapGraphics(handle);
    if (fromGraphics.length > 0) {
      return { rows: fromGraphics, source: `графіка на карті (демо) · ${frameNote}` };
    }
    const image = await symbolPreviewImage(FACILITY_VERIFIED_SYMBOL);
    return {
      rows: image ? [{ label: 'Медичні заклади', image }] : [],
      source: 'демо-символ застосунку',
    };
  }

  const layer = handle.facilityLayer as unknown as {
    renderer?: { toJSON?: () => unknown } | null;
    url?: string | null;
  } | null;

  const toRows = async (
    entries: { label: string; symbol: SymbolUnion }[],
  ): Promise<AreaLegendRowData[]> => {
    const rows = await Promise.all(
      entries.slice(0, 8).map(async (entry) => ({
        label: entry.label || 'Медичні заклади',
        image: await cachedSymbolPreview(previewKey(entry.label, entry.symbol), entry.symbol),
      })),
    );
    return rows.filter((row): row is AreaLegendRowData => row.image !== null);
  };

  // 2. Рендерер завантаженої веб-карти — саме ним намальовані заклади на
  //    експортній карті. Залишаємо лише класи об'єктів, які зараз у кадрі.
  try {
    const rendererJson = layer?.renderer?.toJSON?.();
    if (rendererJson) {
      const entries = await legendFromRenderer(rendererJson, 'Медичні заклади', attributesList);
      const rows = await toRows(entries);
      if (rows.length > 0) {
        return { rows, source: `шар веб-карти · ${frameNote}` };
      }
    }
  } catch {
    // Переходимо до наступного джерела.
  }

  // 3. Рендерер сервісу, який малює цей шар на карті, — з тією самою
  //    фільтрацією за об'єктами в кадрі.
  if (layer?.url) {
    try {
      const entries = await resolveLayerLegendFromService(
        layer.url,
        token,
        'Медичні заклади',
        attributesList,
      );
      const rows = await toRows(entries);
      if (rows.length > 0) {
        return { rows, source: `стиль сервісу шару · ${frameNote}` };
      }
    } catch {
      // Переходимо до наступного джерела.
    }

    try {
      const symbol = await resolveServicePointSymbol(
        layer.url,
        token,
        visible[0]?.attributes ?? facilities[0]?.attributes ?? {},
      );
      const image = symbol ? await symbolPreviewImage(symbol) : null;
      if (image) {
        return { rows: [{ label: 'Медичні заклади', image }], source: 'стиль сервісу шару' };
      }
    } catch {
      // Переходимо до резервного символу.
    }
  }

  const image = await symbolPreviewImage(FACILITY_VERIFIED_SYMBOL);
  return {
    rows: image ? [{ label: 'Медичні заклади', image }] : [],
    source: 'резервний символ застосунку',
  };
}

/** Автоматичний масштаб A3-карти: усі заклади вміщуються з запасом. */
export function areaAutoScaleFor(
  points: LonLat[],
  frameWidthMm: number,
  frameHeightMm: number,
): number {
  if (points.length === 0) return 4_000_000;
  if (points.length === 1) return AREA_MIN_AUTO_SCALE;
  return Math.max(AREA_MIN_AUTO_SCALE, autoScaleFor(points, frameWidthMm, frameHeightMm, 0.1));
}

/** Центр охоплення закладів (або центр України, якщо точок немає). */
export function areaCenter(points: LonLat[]): LonLat {
  return points.length > 0 ? geometryCenter(points) : [31.0, 49.3];
}
