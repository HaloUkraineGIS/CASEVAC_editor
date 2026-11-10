import { useCallback, useEffect, useRef, useState } from 'react';
import Graphic from '@arcgis/core/Graphic.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import Map from '@arcgis/core/Map.js';
import MapView from '@arcgis/core/views/MapView.js';
import WebMap from '@arcgis/core/WebMap.js';
import LayerList from '@arcgis/core/widgets/LayerList.js';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol.js';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol.js';
import Legend from '@arcgis/core/widgets/Legend.js';
import { Layers3, Loader2, MapPinOff, Maximize2, Minimize2 } from 'lucide-react';
import '@arcgis/core/assets/esri/themes/light/main.css';
import { useAuth } from '../auth/AuthContext';
import { appConfig } from '../config/appConfig';
import { BASEMAP_OPTIONS, createBasemap, type BasemapKey } from '../lib/osmBasemap';
import { registerPortalToken } from '../lib/portalToken';
import { rememberLayerRenderer } from '../lib/layerSymbols';
import type { FacilityRecord, LonLat, MinefieldRecord, RouteRecord } from '../types';

interface RoutesMapProps {
  routes: RouteRecord[];
  facilities: FacilityRecord[];
  minefields: MinefieldRecord[];
  /** Фільтр за медичним закладом: 'all' або id закладу. */
  facilityFilterId?: string;
  /** Вибраний маршрут — підсвічується на карті. */
  selectedId: string | null;
  /** Клік по маршруту, мінному полю або закладу на карті. */
  onSelect: (id: string) => void;
  /** Розгорнутий (модальний) режим карти. */
  expanded?: boolean;
  /** Кнопка «на весь екран» / «згорнути». */
  onToggleExpand?: () => void;
}

const ROUTE_SYMBOL = new SimpleLineSymbol({
  color: [31, 122, 92, 0.95],
  width: 2.4,
});

const SELECTED_ROUTE_SYMBOL = new SimpleLineSymbol({
  color: [202, 96, 52],
  width: 4,
});

const FACILITY_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 7,
  color: [74, 117, 152],
  outline: { color: [255, 255, 255], width: 1 },
});

const MINEFIELD_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 6,
  color: [214, 139, 74],
  outline: { color: [255, 255, 255], width: 0.8 },
});

const CENTER_FALLBACK: LonLat = [31.0, 49.3];

/** Умовні позначення демо-режиму — кольори беруться з фактичних символів карти. */
type DemoLegendItem =
  | { key: string; label: string; line: SimpleLineSymbol }
  | { key: string; label: string; point: SimpleMarkerSymbol };

const DEMO_LEGEND: DemoLegendItem[] = [
  { key: 'route', label: 'Маршрут CASEVAC', line: ROUTE_SYMBOL },
  { key: 'selected', label: 'Вибраний маршрут', line: SELECTED_ROUTE_SYMBOL },
  { key: 'facility', label: 'Медичний заклад', point: FACILITY_SYMBOL },
  { key: 'minefield', label: 'Мінне поле (task_id)', point: MINEFIELD_SYMBOL },
];

/** Колір символу ArcGIS → CSS-колір для легенди. */
function cssColor(color: unknown, fallback: string): string {
  const value = color as { r?: number; g?: number; b?: number; a?: number } | null | undefined;
  if (!value || value.r === undefined || value.g === undefined || value.b === undefined) {
    return fallback;
  }
  return `rgba(${Math.round(value.r)}, ${Math.round(value.g)}, ${Math.round(value.b)}, ${value.a ?? 1})`;
}

const VIEW_TIMEOUT_MS = 8000;
const WEBMAP_TIMEOUT_MS = 15000;

/** Мінімальний структурний тип шару WebMap, потрібний для фільтрації за закладом. */
interface FilterableLayer {
  type?: string;
  title?: string;
  url?: string;
  id?: number;
  fields?: { name: string; type?: string }[];
  definitionExpression?: string;
  visible?: boolean;
  renderer?: { toJSON?: () => unknown };
  layers?: { toArray: () => FilterableLayer[] };
  sublayers?: { toArray: () => FilterableLayer[] };
  load?: () => Promise<unknown>;
  refresh?: () => Promise<unknown> | void;
  queryFeatureCount?: (params?: { where?: string }) => Promise<number>;
}

interface PortalLayerMatch {
  /** Точна назва шару у веб-карті. */
  title: string;
  /** URL сервісу з налаштувань застосунку. */
  serviceUrl: string;
  /** Групи ключових слів: достатньо, щоб збіглася будь-яка група (усі слова в ній). */
  titleKeywords: string[][];
  /** Поля, за якими можна впізнати шар, якщо назва/URL у веб-карті інші. */
  fieldNames: string[][];
}

const ROUTE_LAYER_MATCH: PortalLayerMatch = {
  title: appConfig.services.routes.title,
  serviceUrl: appConfig.services.routes.url,
  titleKeywords: [
    ['casevac', 'route'],
    ['casevac', 'маршрут'],
  ],
  fieldNames: [['med_facility_guid'], ['med_facility_globalid'], ['facility_guid']],
};

const FACILITY_LAYER_MATCH: PortalLayerMatch = {
  title: appConfig.services.facilities.title,
  serviceUrl: appConfig.services.facilities.url,
  titleKeywords: [
    ['medical', 'facilit'],
    ['медичн', 'заклад'],
    ['медичн', 'лікарн'],
  ],
  fieldNames: [
    ['facility_type', 'globalid'],
    ['address', 'globalid'],
    ['departments', 'globalid'],
    ['facility_type', 'global_id'],
    ['address', 'global_id'],
    ['departments', 'global_id'],
  ],
};

const START_LAYER_MATCH: PortalLayerMatch = {
  title: appConfig.services.startPoints.title,
  serviceUrl: appConfig.services.startPoints.url,
  titleKeywords: [
    ['start', 'evac'],
    ['start', 'point'],
    ['початк', 'евакуац'],
    ['початок', 'евакуац'],
  ],
  fieldNames: [['parentglobalid'], ['parent_globalid']],
};

/** Шлях сервісу без хоста, токена й завершальних слешів — для порівняння URL різних хостів. */
function serviceKey(url: string | undefined): string {
  if (!url) return '';
  const clean = url.split('?')[0].replace(/\/+$/, '').toLowerCase();
  const marker = '/rest/services/';
  const index = clean.indexOf(marker);
  return index >= 0 ? clean.slice(index + marker.length) : clean;
}

function titleMatches(title: string, match: PortalLayerMatch): boolean {
  if (title === match.title.toLowerCase()) return true;
  return match.titleKeywords.some((group) => group.every((word) => title.includes(word)));
}

/** Підпис сервісу: назва сервісу + id шару, наприклад `casevac_routes/0`. */
function serviceSignature(key: string): string {
  const parts = key.split('/').filter(Boolean);
  const index = parts.findIndex((part) => part === 'featureserver' || part === 'mapserver');
  if (index < 1) return '';
  const name = parts[index - 1];
  const layerId = parts[index + 1] ?? '';
  return layerId.length > 0 ? `${name}/${layerId}` : name;
}

function urlMatches(layerUrl: string | undefined, match: PortalLayerMatch): boolean {
  const key = serviceKey(match.serviceUrl);
  const layerKey = serviceKey(layerUrl);
  if (!key || !layerKey) return false;
  // Повний шлях сервісу може відрізнятися хостом або текою — порівнюємо
  // назву сервісу та id шару, а не лише «featureserver/0».
  const signature = serviceSignature(key);
  return (
    layerKey === key ||
    layerKey.endsWith(`/${key}`) ||
    key.endsWith(`/${layerKey}`) ||
    (signature.length > 0 && serviceSignature(layerKey) === signature)
  );
}

/** Усі шари веб-карти, включно з вкладеними групами та підошвами MapImageLayer. */
function flattenLayers(layers: FilterableLayer[]): FilterableLayer[] {
  const result: FilterableLayer[] = [];
  layers.forEach((layer) => {
    result.push(layer);
    if (layer.layers) result.push(...flattenLayers(layer.layers.toArray()));
    if (layer.sublayers) result.push(...flattenLayers(layer.sublayers.toArray()));
  });
  return result;
}

/** Рекурсивно шукає шар веб-карти за назвою, URL сервісу або характерними полями. */
function findPortalLayer(layers: FilterableLayer[], match: PortalLayerMatch): FilterableLayer | null {
  for (const layer of layers) {
    if (layer.type === 'group' && layer.layers) {
      const nested = findPortalLayer(layer.layers.toArray(), match);
      if (nested) return nested;
      continue;
    }
    if (layer.type === 'map-image' && layer.sublayers) {
      const nested = findPortalLayer(layer.sublayers.toArray(), match);
      if (nested) return nested;
      continue;
    }
    const layerTitle = (layer.title ?? '').trim().toLowerCase();
    if (titleMatches(layerTitle, match) || urlMatches(layer.url, match)) return layer;
  }
  return null;
}

/** Шар, який можна впізнати за його полями (коли назва й URL у веб-карті не збігаються). */
function findLayerByFields(layers: FilterableLayer[], match: PortalLayerMatch): FilterableLayer | null {
  return (
    layers.find((layer) => {
      const names = new Set((layer.fields ?? []).map((field) => field.name.toLowerCase()));
      return match.fieldNames.some((group) => group.every((name) => names.has(name)));
    }) ?? null
  );
}

/** Назва поля шару за списком кандидатів (або за типом globalId). */
function layerField(layer: FilterableLayer | null, names: string[], preferredTypes: string[] = []): string {
  if (!layer?.fields) return '';
  if (preferredTypes.length > 0) {
    const byType = layer.fields.find(
      (field) => field.type !== undefined && preferredTypes.includes(field.type),
    );
    if (byType) return byType.name;
  }
  const available = layer.fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.name.toLowerCase()] = field.name;
    return acc;
  }, {});
  return names.map((name) => available[name]).find(Boolean) ?? '';
}

/** У демо-режимі показуємо лише вибраний заклад (або всі). */
function filterFacilities(facilities: FacilityRecord[], filterId: string): FacilityRecord[] {
  return filterId === 'all' ? facilities : facilities.filter((facility) => facility.id === filterId);
}

/** Мінні поля, пов'язані з видимими маршрутами (у режимі фільтра за закладом). */
function filterMinefields(
  minefields: MinefieldRecord[],
  routes: RouteRecord[],
  filterId: string,
): MinefieldRecord[] {
  if (filterId === 'all') return minefields;
  const taskIds = new Set(routes.map((route) => route.taskId));
  return minefields.filter((minefield) => taskIds.has(minefield.taskId));
}

/** Малює у шарі маршрути, заклади й мінні поля з урахуванням фільтра за закладом. */
function drawFiltered(
  layer: GraphicsLayer,
  routes: RouteRecord[],
  facilities: FacilityRecord[],
  minefields: MinefieldRecord[],
  filterId: string,
): void {
  layer.removeAll();
  const visibleFacilities = filterFacilities(facilities, filterId);
  const visibleMinefields = filterMinefields(minefields, routes, filterId);

  routes.forEach((route) => {
    if (route.geometry.length < 2) return;
    layer.add(routeGraphic(route, ROUTE_SYMBOL, { taskId: route.taskId }));
  });
  visibleMinefields.forEach((minefield) => {
    if (!minefield.location) return;
    layer.add(
      new Graphic({
        geometry: {
          type: 'point',
          longitude: minefield.location[0],
          latitude: minefield.location[1],
        },
        symbol: MINEFIELD_SYMBOL,
        attributes: { taskId: minefield.taskId, taskCode: minefield.taskCode },
      }),
    );
  });
  visibleFacilities.forEach((facility) => {
    if (!facility.location) return;
    layer.add(
      new Graphic({
        geometry: {
          type: 'point',
          longitude: facility.location[0],
          latitude: facility.location[1],
        },
        symbol: FACILITY_SYMBOL,
        attributes: { facilityId: facility.id },
      }),
    );
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

/** Центр і масштаб, щоб усі точки маршрутів (або закладів) вмістилися у вікні. */
function fitView(points: LonLat[], width: number, height: number): { center: LonLat; zoom: number } | null {
  if (points.length === 0) return null;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  points.forEach(([lon, lat]) => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  });
  const center: LonLat = [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
  const lonSpan = Math.max(maxLon - minLon, 0.08);
  const latSpan = Math.max(maxLat - minLat, 0.08);
  const meanLatRad = (center[1] * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(meanLatRad), 0.2);
  const safeWidth = Math.max(width, 240);
  const safeHeight = Math.max(height, 200);
  const zoomLon = Math.log2((safeWidth * 0.86 * 360) / (256 * lonSpan));
  const zoomLat = Math.log2((safeHeight * 0.86 * 360 * cosLat) / (256 * latSpan));
  const zoom = Math.min(12, Math.max(4, Math.min(zoomLon, zoomLat)));
  return { center, zoom };
}

/** Лінія маршруту у WGS84. */
function routeGraphic(route: RouteRecord, symbol: SimpleLineSymbol, extra: Record<string, unknown>) {
  return new Graphic({
    geometry: {
      type: 'polyline',
      paths: [route.geometry],
      spatialReference: { wkid: 4326 },
    },
    symbol,
    attributes: { routeId: route.id, ...extra },
  });
}

/** Серверні шари сторінки маршрутів більше не створюються вручну: у портальному режимі карта завантажується з WebMap Portal. */
/**
 * Карта сторінки «Маршрути CASEVAC ділянок розмінування».
 *
 * У режимі Portal показує серверні шари: медичні заклади, маршрути евакуації,
 * полігони обстежень, лінію фронту та мінні поля (їх зв'язок із маршрутами —
 * поля task_id / task_code). Без токена (демо-режим) малює маршрути, заклади
 * й мінні поля з поточного знімка даних на тій самій підкладці.
 */
export function RoutesMap({
  routes,
  facilities,
  minefields,
  facilityFilterId = 'all',
  selectedId,
  onSelect,
  expanded = false,
  onToggleExpand,
}: RoutesMapProps) {
  const { session } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const highlightRef = useRef<GraphicsLayer | null>(null);
  const fallbackRef = useRef<GraphicsLayer | null>(null);
  const modeRef = useRef<'portal' | 'demo'>('demo');
  const routesRef = useRef<RouteRecord[]>(routes);
  const facilitiesRef = useRef<FacilityRecord[]>(facilities);
  const minefieldsRef = useRef<MinefieldRecord[]>(minefields);
  const facilityFilterRef = useRef(facilityFilterId);
  const selectedRef = useRef<string | null>(selectedId);
  const onSelectRef = useRef(onSelect);
  const basemapKeyRef = useRef<BasemapKey>('osm');
  const legendRef = useRef<Legend | null>(null);
  const layerListRef = useRef<LayerList | null>(null);
  const legendVisibleRef = useRef(false);
  const layerListVisibleRef = useRef(false);
  const mapRef = useRef<Map | WebMap | null>(null);
  const portalRouteLayerRef = useRef<FilterableLayer | null>(null);
  const portalFacilityLayerRef = useRef<FilterableLayer | null>(null);
  const portalRouteBaseExprRef = useRef('');
  const portalFacilityBaseExprRef = useRef('');
  const portalRouteBaseVisibleRef = useRef(true);
  const portalFacilityBaseVisibleRef = useRef(true);
  const portalOverlayRef = useRef<GraphicsLayer | null>(null);
  const portalFilterSeqRef = useRef(0);
  const focusedRef = useRef(false);

  const [basemapKey, setBasemapKey] = useState<BasemapKey>('osm');
  const [legendVisible, setLegendVisible] = useState(false);
  const [layerListVisible, setLayerListVisible] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  routesRef.current = routes;
  facilitiesRef.current = facilities;
  minefieldsRef.current = minefields;
  facilityFilterRef.current = facilityFilterId;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;
  basemapKeyRef.current = basemapKey;
  legendVisibleRef.current = legendVisible;
  layerListVisibleRef.current = layerListVisible;

  const token = session?.token ?? null;

  const drawFallback = useCallback(() => {
    const layer = fallbackRef.current;
    if (!layer) return;
    if (modeRef.current !== 'demo') {
      layer.removeAll();
      return;
    }
    drawFiltered(
      layer,
      routesRef.current,
      facilitiesRef.current,
      minefieldsRef.current,
      facilityFilterRef.current,
    );
  }, []);

  /**
   * Резервна візуалізація фільтра в Portal: якщо поля серверних шарів не
   * вдалося визначити, ховаємо шари й малюємо відфільтровані об'єкти поверх.
   */
  const drawPortalOverlay = useCallback(() => {
    const layer = portalOverlayRef.current;
    if (!layer) return;
    layer.removeAll();
    if (modeRef.current !== 'portal' || facilityFilterRef.current === 'all') return;
    drawFiltered(
      layer,
      routesRef.current,
      facilitiesRef.current,
      minefieldsRef.current,
      facilityFilterRef.current,
    );
  }, []);

  const drawHighlight = useCallback(() => {
    const layer = highlightRef.current;
    if (!layer) return;
    layer.removeAll();
    const route = routesRef.current.find((item) => item.id === selectedRef.current);
    if (!route || route.geometry.length < 2) return;
    layer.add(routeGraphic(route, SELECTED_ROUTE_SYMBOL, { highlighted: true }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let view: MapView | null = null;
    let observer: ResizeObserver | null = null;
    focusedRef.current = false;

    /** Легенда та список шарів — однакові для Portal і демо-режиму. */
    const attachWidgets = (nextView: MapView, withLegend: boolean) => {
      if (withLegend) {
        const legend = new Legend({ view: nextView });
        legend.visible = legendVisibleRef.current;
        legendRef.current = legend;
        nextView.ui.add(legend, { position: 'bottom-right', index: 999 });
      }

      const layerList = new LayerList({
        view: nextView,
        listItemCreatedFunction: (event) => {
          const item = event.item;
          item.actionsSections = [];
        },
      });
      layerList.visible = layerListVisibleRef.current;
      layerListRef.current = layerList;
      nextView.ui.add(layerList, { position: 'top-right', index: 998 });
    };

    const focusAll = () => {
      if (!view || focusedRef.current) return;
      focusedRef.current = true;
      const filterId = facilityFilterRef.current;
      const points: LonLat[] = [];
      routesRef.current.forEach((route) => points.push(...route.geometry));
      filterFacilities(facilitiesRef.current, filterId).forEach((facility) => {
        if (facility.location) points.push(facility.location);
      });
      filterMinefields(minefieldsRef.current, routesRef.current, filterId).forEach((minefield) => {
        if (minefield.location) points.push(minefield.location);
      });
      const viewport = fitView(points, view.width, view.height);
      if (viewport) void view.goTo(viewport);
    };

    const handleClick = (nextView: MapView, event: { x: number; y: number }) => {
      void nextView
        .hitTest(event)
        .then((response) => {
          for (const result of response.results) {
            if (result.type !== 'graphic') continue;
            const attributes = result.graphic?.attributes ?? {};
            const directRoute = attributes.routeId;
            if (typeof directRoute === 'string') {
              onSelectRef.current(directRoute);
              return;
            }
            const directFacility = attributes.facilityId;
            if (typeof directFacility === 'string') {
              onSelectRef.current(
                routesRef.current.find((route) => route.facilityId === directFacility)?.id ??
                  routesRef.current[0]?.id ??
                  directFacility,
              );
              return;
            }
            const routeKey = String(attributes.globalid ?? attributes.global_id ?? '');
            const byId = routeKey ? routesRef.current.find((route) => route.id === routeKey) : undefined;
            if (byId) {
              onSelectRef.current(byId.id);
              return;
            }
            const objectId = attributes.objectid;
            if (objectId !== undefined) {
              const facility = facilitiesRef.current.find(
                (item) => String(item.objectId) === String(objectId),
              );
              if (facility) {
                const linked = routesRef.current.find((route) => route.facilityId === facility.id);
                if (linked) {
                  onSelectRef.current(linked.id);
                  return;
                }
              }
            }
            const taskId = attributes.task_id;
            const taskCode = attributes.task_code;
            const linkedRoute = routesRef.current.find(
              (route) =>
                (taskId !== undefined && taskId !== null && route.taskId === String(taskId)) ||
                (typeof taskCode === 'string' && taskCode.length > 0 && route.code === taskCode),
            );
            if (linkedRoute) {
              onSelectRef.current(linkedRoute.id);
              return;
            }
          }
        })
        .catch(() => undefined);
    };

    const startDemo = () => {
      if (cancelled || !containerRef.current) return;
      modeRef.current = 'demo';
      const map = new Map({ basemap: createBasemap(basemapKeyRef.current) });
      // Шар демо-даних лишаємо доступним у «Списку шарів», щоб кнопка працювала і без Portal.
      const fallback = new GraphicsLayer({ title: 'Демо-дані' });
      map.add(fallback);
      fallbackRef.current = fallback;
      const highlight = new GraphicsLayer({ listMode: 'hide' });
      map.add(highlight);
      highlightRef.current = highlight;
      mapRef.current = map;

      view = new MapView({
        container: containerRef.current,
        map,
        center: CENTER_FALLBACK,
        zoom: 6,
        popupEnabled: false,
        ui: { components: ['zoom', 'compass'] },
      });
      viewRef.current = view;
      if (import.meta.env.DEV) {
        (window as unknown as Record<string, unknown>).__routesMapView = view;
      }
      view.on('click', (event: { x: number; y: number }) => handleClick(view as MapView, event));

      void view
        .when()
        .then(() => {
          if (cancelled) return;
          drawFallback();
          drawHighlight();
          attachWidgets(view as MapView, false);
          setStatus('ready');
          focusAll();
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setStatus('error');
          setMessage(cause instanceof Error ? cause.message : 'Невідома помилка карти');
        });
    };

    const start = async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled || !containerRef.current) return;

        // Карта живе і в панелі, і в розгорнутому режимі — підганяємо розмір під контейнер.
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => {
            const current = viewRef.current as unknown as { resize?: () => void } | null;
            current?.resize?.();
          });
          observer.observe(containerRef.current);
        }

        if (!token) {
          startDemo();
          return;
        }

        registerPortalToken(token, session?.expiresAt ?? 0);
        modeRef.current = 'portal';
        const webmap = new WebMap({ portalItem: { id: appConfig.webMapId } });
        const loaded = await withTimeout(webmap.load(), WEBMAP_TIMEOUT_MS);
        if (cancelled) return;
        if (!loaded) throw new Error('Portal не відповів на запит веб-карти');

        webmap.basemap = createBasemap(basemapKeyRef.current);
        const highlight = new GraphicsLayer({ listMode: 'hide' });
        webmap.add(highlight);
        highlightRef.current = highlight;
        const filterOverlay = new GraphicsLayer({ listMode: 'hide' });
        webmap.add(filterOverlay);
        portalOverlayRef.current = filterOverlay;
        mapRef.current = webmap;

        view = new MapView({
          container: containerRef.current,
          map: webmap,
          center: CENTER_FALLBACK,
          zoom: 6,
          popupEnabled: false,
          ui: { components: ['zoom', 'compass'] },
        });
        viewRef.current = view;
        if (import.meta.env.DEV) {
          (window as unknown as Record<string, unknown>).__routesMapView = view;
        }
        view.on('click', (event: { x: number; y: number }) => handleClick(view as MapView, event));

        await withTimeout(view.when(), VIEW_TIMEOUT_MS);
        if (cancelled) return;

        attachWidgets(view, true);

        // Знаходимо серверні шари, щоб фільтрувати їх за вибраним закладом.
        const webmapLayers = (webmap.layers as unknown as { toArray: () => FilterableLayer[] }).toArray();
        let routeLayer = findPortalLayer(webmapLayers, ROUTE_LAYER_MATCH);
        let facilityLayer = findPortalLayer(webmapLayers, FACILITY_LAYER_MATCH);
        let startLayer = findPortalLayer(webmapLayers, START_LAYER_MATCH);

        // Назви або URL у веб-карті можуть відрізнятися від налаштувань
        // застосунку — тоді впізнаємо шари за характерними полями.
        if (!routeLayer || !facilityLayer || !startLayer) {
          // Спочатку завантажуємо верхній рівень (групи створюють дочірні шари),
          // потім — усі вкладені шари, щоб мати доступ до їхніх полів.
          await withTimeout(Promise.all(webmapLayers.map((layer) => layer.load?.())), WEBMAP_TIMEOUT_MS);
          const allLayers = flattenLayers(webmapLayers);
          await withTimeout(Promise.all(allLayers.map((layer) => layer.load?.())), WEBMAP_TIMEOUT_MS);
          if (cancelled) return;
          routeLayer ??= findLayerByFields(allLayers, ROUTE_LAYER_MATCH);
          facilityLayer ??= findLayerByFields(allLayers, FACILITY_LAYER_MATCH);
          startLayer ??= findLayerByFields(allLayers, START_LAYER_MATCH);
        }

        portalRouteLayerRef.current = routeLayer;
        portalFacilityLayerRef.current = facilityLayer;
        await withTimeout(
          Promise.all([routeLayer?.load?.(), facilityLayer?.load?.(), startLayer?.load?.()]),
          VIEW_TIMEOUT_MS,
        );
        if (cancelled) return;

        // Запам'ятовуємо умовні позначення шарів для PDF-експорту: вони мають
        // бути такими самими, як на цій карті.
        if (facilityLayer?.renderer?.toJSON) {
          rememberLayerRenderer('facility', facilityLayer.renderer.toJSON());
        }
        if (startLayer?.renderer?.toJSON) {
          rememberLayerRenderer('start', startLayer.renderer.toJSON());
        }

        portalRouteBaseExprRef.current = routeLayer?.definitionExpression ?? '';
        portalFacilityBaseExprRef.current = facilityLayer?.definitionExpression ?? '';
        portalRouteBaseVisibleRef.current = routeLayer?.visible ?? true;
        portalFacilityBaseVisibleRef.current = facilityLayer?.visible ?? true;

        if (import.meta.env.DEV) {
          console.info('[RoutesMap] Portal-шари для фільтра за закладом', {
            routes: routeLayer?.title ?? 'не знайдено',
            facilities: facilityLayer?.title ?? 'не знайдено',
            startPoints: startLayer?.title ?? 'не знайдено',
          });
        }

        setStatus('ready');
        focusAll();
      } catch (cause) {
        if (cancelled) return;
        setStatus('error');
        setMessage(cause instanceof Error ? cause.message : 'Невідома помилка карти');
      }
    };

    void start();

    return () => {
      cancelled = true;
      observer?.disconnect();
      viewRef.current = null;
      highlightRef.current = null;
      fallbackRef.current = null;
      legendRef.current = null;
      layerListRef.current = null;
      mapRef.current = null;
      portalRouteLayerRef.current = null;
      portalFacilityLayerRef.current = null;
      portalOverlayRef.current = null;
      portalFilterSeqRef.current = 0;
      view?.destroy();
    };
  }, [token, session?.expiresAt, drawFallback, drawHighlight]);

  useEffect(() => {
    drawFallback();
    drawHighlight();
    drawPortalOverlay();
  }, [
    routes,
    facilities,
    minefields,
    facilityFilterId,
    selectedId,
    drawFallback,
    drawHighlight,
    drawPortalOverlay,
    status,
  ]);

  // У режимі Portal фільтруємо серверні шари за вибраним закладом.
  const applyPortalFilter = useCallback(() => {
    if (modeRef.current !== 'portal') return;
    const seq = ++portalFilterSeqRef.current;
    const filterId = facilityFilterRef.current;
    const routesLayer = portalRouteLayerRef.current;
    const facilitiesLayer = portalFacilityLayerRef.current;

    const setExpression = (layer: FilterableLayer | null, expression: string) => {
      if (!layer || layer.definitionExpression === expression) return;
      layer.definitionExpression = expression;
      // Деякі шари не мають refresh — достатньо самого definitionExpression.
      void Promise.resolve(layer.refresh?.()).catch(() => undefined);
    };
    const setVisible = (layer: FilterableLayer | null, visible: boolean) => {
      if (layer && layer.visible !== visible) layer.visible = visible;
    };
    const showOverlay = () => {
      setExpression(routesLayer, portalRouteBaseExprRef.current);
      setExpression(facilitiesLayer, portalFacilityBaseExprRef.current);
      setVisible(routesLayer, false);
      setVisible(facilitiesLayer, false);
      drawPortalOverlay();
    };

    // Скидання фільтра: повертаємо початкові вирази та видимість шарів.
    if (filterId === 'all') {
      setExpression(routesLayer, portalRouteBaseExprRef.current);
      setExpression(facilitiesLayer, portalFacilityBaseExprRef.current);
      setVisible(routesLayer, portalRouteBaseVisibleRef.current);
      setVisible(facilitiesLayer, portalFacilityBaseVisibleRef.current);
      drawPortalOverlay();
      return;
    }

    const escaped = filterId.replace(/'/g, "''");
    const routeField = layerField(routesLayer, [
      'med_facility_guid',
      'med_facility_globalid',
      'med_facility_id',
      'facility_guid',
      'facility_globalid',
      'facility_id',
    ]);
    const facilityField = layerField(
      facilitiesLayer,
      ['globalid', 'global_id', 'guid'],
      ['global-id', 'guid'],
    );

    if (import.meta.env.DEV) {
      console.info('[RoutesMap] Фільтр карти за закладом', {
        facilityId: filterId,
        routeLayer: routesLayer?.title,
        facilityLayer: facilitiesLayer?.title,
        routeField,
        facilityField,
      });
    }

    if (!routeField || !facilityField || typeof routesLayer?.refresh !== 'function') {
      // Поля не визначено або шар не оновлюється через definitionExpression
      // (наприклад, підошва MapImageLayer): ховаємо серверні шари
      // й малюємо відфільтровані дані поверх карти.
      showOverlay();
      return;
    }

    const routeExpression = `${routeField} = '${escaped}'`;
    const facilityExpression = `${facilityField} = '${escaped}'`;
    setExpression(routesLayer, routeExpression);
    setExpression(facilitiesLayer, facilityExpression);
    setVisible(routesLayer, true);
    setVisible(facilitiesLayer, true);
    drawPortalOverlay();

    // Серверний фільтр може не дати результатів, якщо значення поля маршруту
    // не збігається з id закладу в застосунку — тоді переходимо на резервний шар.
    const count = routesLayer?.queryFeatureCount?.({ where: routeExpression });
    if (!count) return;
    void count
      .then((total) => {
        if (seq !== portalFilterSeqRef.current || total > 0) return;
        if (import.meta.env.DEV) {
          console.info('[RoutesMap] Серверний фільтр не дав маршрутів — резервний шар');
        }
        showOverlay();
      })
      .catch(() => {
        // Перевірити результат не вдалося — резервний шар гарантує видимий ефект.
        if (seq === portalFilterSeqRef.current) showOverlay();
      });
  }, [drawPortalOverlay]);

  useEffect(() => {
    if (status !== 'ready') return;
    applyPortalFilter();
  }, [facilityFilterId, status, applyPortalFilter]);

  // Зміна фільтра за закладом масштабує карту на видимі об'єкти.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || status !== 'ready') return;

    const points: LonLat[] = [];
    if (facilityFilterId === 'all') {
      routesRef.current.forEach((route) => points.push(...route.geometry));
      filterFacilities(facilitiesRef.current, 'all').forEach((facility) => {
        if (facility.location) points.push(facility.location);
      });
      filterMinefields(minefieldsRef.current, routesRef.current, 'all').forEach((minefield) => {
        if (minefield.location) points.push(minefield.location);
      });
    } else {
      const facility = facilitiesRef.current.find((item) => item.id === facilityFilterId);
      if (facility?.location) points.push(facility.location);
      routesRef.current
        .filter((route) => route.facilityId === facilityFilterId)
        .forEach((route) => points.push(...route.geometry));
    }

    const viewport = fitView(points, view.width, view.height);
    if (viewport) void view.goTo(viewport);
  }, [facilityFilterId, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    map.basemap = createBasemap(basemapKey);
  }, [basemapKey, status]);

  useEffect(() => {
    if (legendRef.current) legendRef.current.visible = legendVisible;
  }, [legendVisible]);

  // Показ/приховування списку шарів.
  useEffect(() => {
    if (layerListRef.current) layerListRef.current.visible = layerListVisible;
  }, [layerListVisible]);

  // Зумування до вибраного маршруту при зміні selectedId
  useEffect(() => {
    const view = viewRef.current;
    if (!view || status !== 'ready' || !selectedId) return;

    const route = routesRef.current.find((r) => r.id === selectedId);
    if (!route || route.geometry.length < 2) return;

    const points = route.geometry;
    const viewport = fitView(points, view.width, view.height);
    if (viewport) {
      void view.goTo(viewport);
    }
  }, [selectedId, status]);

  // Escape згортає розгорнуту карту.
  useEffect(() => {
    if (!expanded || !onToggleExpand) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggleExpand();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [expanded, onToggleExpand]);

  // Розгорнута карта блокує прокручування сторінки під нею.
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  return (
    <div className={`facility-map-wrap routes-map ${expanded ? 'routes-map-expanded' : ''}`}>
      <div ref={containerRef} className="facility-map" />
      {status !== 'error' && (
        <div className="facility-map-controls">
          <div className="facility-map-control-row">
            <label className="facility-basemap-control">
              <select
                value={basemapKey}
                onChange={(event) => setBasemapKey(event.target.value as BasemapKey)}
                aria-label="Базова карта"
              >
                {BASEMAP_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {status === 'ready' && (
              <button
                type="button"
                className={`facility-legend-toggle ${legendVisible ? 'is-active' : ''}`}
                onClick={() => setLegendVisible((visible) => !visible)}
                aria-pressed={legendVisible}
                aria-label="Показати умовні знаки"
                title="Умовні знаки шарів"
              >
                <Layers3 size={13} />
                <span className="routes-map-control-label">Легенда</span>
              </button>
            )}
            {status === 'ready' && (
              <button
                type="button"
                className={`facility-legend-toggle ${layerListVisible ? 'is-active' : ''}`}
                onClick={() => setLayerListVisible((visible) => !visible)}
                aria-pressed={layerListVisible}
                aria-label="Показати список шарів"
                title="Список шарів"
              >
                <Layers3 size={13} />
                <span className="routes-map-control-label">Список шарів</span>
              </button>
            )}
            {onToggleExpand && (
              <button
                type="button"
                className="facility-legend-toggle routes-map-expand"
                onClick={onToggleExpand}
                aria-label={expanded ? 'Згорнути карту' : 'Розгорнути карту на весь екран'}
                title={expanded ? 'Згорнути карту' : 'Розгорнути на весь екран'}
              >
                {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                <span className="routes-map-control-label">{expanded ? 'Згорнути' : 'На весь екран'}</span>
              </button>
            )}
          </div>
        </div>
      )}
      {status === 'loading' && (
        <div className="facility-map-state">
          <Loader2 size={16} className="spin" />
          <span>Завантажуємо карту…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="facility-map-state facility-map-error">
          <MapPinOff size={16} />
          <span>Карту не вдалося завантажити.</span>
        </div>
      )}
      {status === 'ready' && modeRef.current === 'demo' && legendVisible && (
        <div className="routes-map-legend" role="note" aria-label="Умовні позначення шарів">
          <div className="routes-map-legend-title">Умовні позначення</div>
          {DEMO_LEGEND.map((item) =>
            'line' in item ? (
              <div className="routes-map-legend-row" key={item.key}>
                <span
                  className="routes-map-legend-line"
                  style={{
                    background: cssColor(item.line.color, '#1f7a5c'),
                    height: `${Math.max(2, Math.round(item.line.width ?? 2))}px`,
                  }}
                />
                <span>{item.label}</span>
              </div>
            ) : (
              <div className="routes-map-legend-row" key={item.key}>
                <span
                  className="routes-map-legend-dot"
                  style={{
                    background: cssColor(item.point.color, '#4a7598'),
                    borderColor: cssColor(item.point.outline?.color, '#ffffff'),
                  }}
                />
                <span>{item.label}</span>
              </div>
            ),
          )}
        </div>
      )}
      {status === 'ready' && modeRef.current === 'demo' && (
        <span className="facility-map-hint">Натисніть на маршрут або мінне поле, щоб вибрати</span>
      )}
      {status === 'error' && message && <span className="facility-map-details">{message}</span>}
    </div>
  );
}
