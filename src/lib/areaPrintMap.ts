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
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import type Layer from '@arcgis/core/layers/Layer.js';
import type Sublayer from '@arcgis/core/layers/support/Sublayer.js';
import Map from '@arcgis/core/Map.js';
import MapView from '@arcgis/core/views/MapView.js';
import WebMap from '@arcgis/core/WebMap.js';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol.js';
import { appConfig } from '../config/appConfig';
import { AREA_MIN_AUTO_SCALE } from './areaPrintLayout';
import { autoScaleFor, geometryCenter } from './printMap';
import { legendFromRenderer, resolveLayerLegendFromService } from './layerSymbols';
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

const WEBMAP_TIMEOUT_MS = 15000;
const VIEW_TIMEOUT_MS = 15000;

export const AREA_FALLBACK_FACILITY_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 13,
  color: [45, 111, 191, 1],
  outline: { color: [255, 255, 255, 1], width: 2 },
});

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
          symbol: AREA_FALLBACK_FACILITY_SYMBOL,
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
 * Легенда A3-аркуша: лише умовні позначення шару «Медичні заклади».
 * Підкладка у легенду не додається.
 */
export async function buildAreaLegendRows(
  handle: AreaMapHandle,
  token: string | null,
): Promise<AreaLegendRowData[]> {
  const fallback = async (): Promise<AreaLegendRowData[]> => [
    {
      label: 'Медичні заклади',
      image: await symbolPreviewImage(AREA_FALLBACK_FACILITY_SYMBOL),
    },
  ];

  const layer = handle.facilityLayer as unknown as {
    renderer?: { toJSON?: () => unknown } | null;
    url?: string | null;
  } | null;
  if (!layer) return fallback();

  let entries = [] as Awaited<ReturnType<typeof legendFromRenderer>>;
  try {
    if (layer.renderer?.toJSON) {
      entries = await legendFromRenderer(layer.renderer.toJSON(), 'Медичні заклади');
    }
  } catch {
    entries = [];
  }

  if (entries.length === 0 && layer.url) {
    try {
      entries = await resolveLayerLegendFromService(layer.url, token, 'Медичні заклади');
    } catch {
      entries = [];
    }
  }

  if (entries.length === 0) return fallback();

  return Promise.all(
    entries.map(async (entry) => ({
      label: entry.label || 'Медичні заклади',
      image: await symbolPreviewImage(entry.symbol),
    })),
  );
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
