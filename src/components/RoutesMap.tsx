import { useCallback, useEffect, useRef, useState } from 'react';
import esriConfig from '@arcgis/core/config.js';
import Graphic from '@arcgis/core/Graphic.js';
import IdentityManager from '@arcgis/core/identity/IdentityManager.js';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import type Layer from '@arcgis/core/layers/Layer.js';
import MapImageLayer from '@arcgis/core/layers/MapImageLayer.js';
import Map from '@arcgis/core/Map.js';
import MapView from '@arcgis/core/views/MapView.js';
import SimpleRenderer from '@arcgis/core/renderers/SimpleRenderer.js';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol.js';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol.js';
import Legend from '@arcgis/core/widgets/Legend.js';
import { Layers3, Loader2, MapPinOff, Maximize2, Minimize2 } from 'lucide-react';
import '@arcgis/core/assets/esri/themes/light/main.css';
import { useAuth } from '../auth/AuthContext';
import { appConfig } from '../config/appConfig';
import { BASEMAP_OPTIONS, createBasemap, type BasemapKey } from '../lib/osmBasemap';
import type { FacilityRecord, LonLat, MinefieldRecord, RouteRecord } from '../types';

interface RoutesMapProps {
  routes: RouteRecord[];
  facilities: FacilityRecord[];
  minefields: MinefieldRecord[];
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
const LAYER_TIMEOUT_MS = 12000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

/** Реєструє токен Portal для карти та пов'язаних сервісів. */
function registerPortalToken(token: string, expiresAt: number): void {
  esriConfig.portalUrl = appConfig.portalUrl;
  const expires = expiresAt > Date.now() ? expiresAt : undefined;
  IdentityManager.registerToken({
    server: `${appConfig.portalUrl}/sharing/rest`,
    token,
    expires,
    ssl: true,
  });
  IdentityManager.registerToken({
    server: 'https://gis-services.htgoims.org/arcgis/rest/services',
    token,
    expires,
    ssl: true,
  });
  IdentityManager.registerToken({
    server: 'https://gis.htgoims.org/server/rest/services',
    token,
    expires,
    ssl: true,
  });
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

/** Серверні шари сторінки маршрутів: полігони, лінія фронту, мінні поля, маршрути, заклади. */
function createServiceLayers(): {
  layers: Layer[];
  routes: FeatureLayer;
  facilities: FeatureLayer;
  mapImages: MapImageLayer[];
} {
  const survey = new MapImageLayer({
    url: appConfig.services.surveyPolygons.url,
    title: appConfig.services.surveyPolygons.title,
    opacity: 0.75,
  });
  const cbSurvey = new MapImageLayer({
    url: appConfig.services.cbSurveyPolygons.url,
    title: appConfig.services.cbSurveyPolygons.title,
    opacity: 0.75,
  });
  const frontline = new FeatureLayer({
    url: appConfig.services.frontline.url,
    title: appConfig.services.frontline.title,
    outFields: ['*'],
    popupEnabled: false,
  });
  const minefields = new MapImageLayer({
    url: appConfig.services.minefields.url,
    title: appConfig.services.minefields.title,
  });
  const routes = new FeatureLayer({
    url: appConfig.services.routes.url,
    title: appConfig.services.routes.title,
    outFields: ['*'],
    popupEnabled: false,
    renderer: new SimpleRenderer({ symbol: ROUTE_SYMBOL }),
  });
  const facilities = new FeatureLayer({
    url: appConfig.services.facilities.url,
    title: appConfig.services.facilities.title,
    outFields: ['*'],
    popupEnabled: false,
    renderer: new SimpleRenderer({ symbol: FACILITY_SYMBOL }),
  });

  return {
    layers: [survey, cbSurvey, frontline, minefields, routes, facilities],
    routes,
    facilities,
    mapImages: [survey, cbSurvey, minefields],
  };
}

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
  const selectedRef = useRef<string | null>(selectedId);
  const onSelectRef = useRef(onSelect);
  const basemapKeyRef = useRef<BasemapKey>('osm');
  const legendRef = useRef<Legend | null>(null);
  const legendVisibleRef = useRef(false);
  const mapRef = useRef<Map | null>(null);
  const focusedRef = useRef(false);

  const [basemapKey, setBasemapKey] = useState<BasemapKey>('osm');
  const [legendVisible, setLegendVisible] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');

  routesRef.current = routes;
  facilitiesRef.current = facilities;
  minefieldsRef.current = minefields;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;
  basemapKeyRef.current = basemapKey;
  legendVisibleRef.current = legendVisible;

  const token = session?.token ?? null;

  const drawFallback = useCallback(() => {
    const layer = fallbackRef.current;
    if (!layer) return;
    layer.removeAll();
    if (modeRef.current !== 'demo') return;
    routesRef.current.forEach((route) => {
      if (route.geometry.length < 2) return;
      layer.add(routeGraphic(route, ROUTE_SYMBOL, { taskId: route.taskId }));
    });
    minefieldsRef.current.forEach((minefield) => {
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
    facilitiesRef.current.forEach((facility) => {
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

    const focusAll = () => {
      if (!view || focusedRef.current) return;
      focusedRef.current = true;
      const points: LonLat[] = [];
      routesRef.current.forEach((route) => points.push(...route.geometry));
      facilitiesRef.current.forEach((facility) => {
        if (facility.location) points.push(facility.location);
      });
      minefieldsRef.current.forEach((minefield) => {
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
            const byId = routeKey
              ? routesRef.current.find((route) => route.id === routeKey)
              : undefined;
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
      setNotice('Демо-режим: маршрути, заклади й мінні поля з демо-даних.');
      const map = new Map({ basemap: createBasemap(basemapKeyRef.current) });
      const fallback = new GraphicsLayer({ title: 'Демо-дані', listMode: 'hide' });
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
        const { layers, mapImages } = createServiceLayers();
        const map = new Map({
          basemap: createBasemap(basemapKeyRef.current),
          layers,
        });
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

        await withTimeout(view.when(), VIEW_TIMEOUT_MS);
        if (cancelled) return;

        // У MapServer показуємо лише шар із індексом 0 (полігони/мінні поля).
        await Promise.all(
          mapImages.map(async (layer) => {
            await withTimeout(layer.load(), LAYER_TIMEOUT_MS);
            layer.sublayers?.forEach((sublayer) => {
              sublayer.visible = sublayer.id === 0;
            });
          }),
        );
        if (cancelled) return;

        const legend = new Legend({ view });
        legend.visible = legendVisibleRef.current;
        legendRef.current = legend;
        view.ui.add(legend, 'bottom-right');

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
      mapRef.current = null;
      view?.destroy();
    };
  }, [token, session?.expiresAt, drawFallback, drawHighlight]);

  useEffect(() => {
    drawFallback();
    drawHighlight();
  }, [routes, facilities, minefields, selectedId, drawFallback, drawHighlight, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    map.basemap = createBasemap(basemapKey);
  }, [basemapKey, status]);

  useEffect(() => {
    if (legendRef.current) legendRef.current.visible = legendVisible;
  }, [legendVisible]);

  // Escape згортає розгорнуту карту.
  useEffect(() => {
    if (!expanded || !onToggleExpand) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggleExpand();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [expanded, onToggleExpand]);

  return (
    <div className={`facility-map-wrap routes-map ${expanded ? 'routes-map-expanded' : ''}`}>
      <div ref={containerRef} className="facility-map" />
      {status !== 'error' && (
        <div className="facility-map-controls">
          <div className="facility-map-control-row">
            <label className="facility-basemap-control">
              <span>Підкладка</span>
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
            {onToggleExpand && (
              <button
                type="button"
                className="facility-legend-toggle routes-map-expand"
                onClick={onToggleExpand}
                aria-label={expanded ? 'Згорнути карту' : 'Розгорнути карту на весь екран'}
                title={expanded ? 'Згорнути карту' : 'Розгорнути на весь екран'}
              >
                {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                <span className="routes-map-control-label">
                  {expanded ? 'Згорнути' : 'На весь екран'}
                </span>
              </button>
            )}
          </div>
          {notice && status === 'ready' && <span className="facility-map-notice">{notice}</span>}
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
