import { useCallback, useEffect, useRef, useState } from 'react';
import esriConfig from '@arcgis/core/config.js';
import type Collection from '@arcgis/core/core/Collection.js';
import Point from '@arcgis/core/geometry/Point.js';
import Graphic from '@arcgis/core/Graphic.js';
import IdentityManager from '@arcgis/core/identity/IdentityManager.js';
import type FeatureLayer from '@arcgis/core/layers/FeatureLayer.js';
import type GroupLayer from '@arcgis/core/layers/GroupLayer.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import type Layer from '@arcgis/core/layers/Layer.js';
import type MapImageLayer from '@arcgis/core/layers/MapImageLayer.js';
import type Sublayer from '@arcgis/core/layers/support/Sublayer.js';
import Map from '@arcgis/core/Map.js';
import MapView from '@arcgis/core/views/MapView.js';
import WebMap from '@arcgis/core/WebMap.js';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol.js';
import Legend from '@arcgis/core/widgets/Legend.js';
import { Loader2, MapPinOff } from 'lucide-react';
import '@arcgis/core/assets/esri/themes/light/main.css';
import { useAuth } from '../auth/AuthContext';
import { appConfig } from '../config/appConfig';
import { isVisitStale } from '../lib/format';
import { BASEMAP_OPTIONS, createBasemap, type BasemapKey } from '../lib/osmBasemap';
import type { FacilityRecord, LonLat } from '../types';

interface FacilitiesMapProps {
  /** Заклади, які треба показати (з урахуванням пошуку). */
  facilities: FacilityRecord[];
  /** Вибраний заклад — підсвічується на карті. */
  selectedId: string | null;
  /** Клік по маркеру закладу. */
  onSelect: (id: string) => void;
  /** Чи активний пошук: тоді шар веб-карти фільтрується за видимими закладами. */
  filterActive?: boolean;
}

const VERIFIED_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 8,
  color: [66, 170, 120],
  outline: { color: [255, 255, 255], width: 1 },
});

const STALE_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 8,
  color: [214, 163, 82],
  outline: { color: [255, 255, 255], width: 1 },
});

const SELECTED_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 16,
  color: [190, 92, 71],
  outline: { color: [255, 255, 255], width: 2 },
});

/** Кільце навколо вибраного закладу, коли символи дає шар веб-карти. */
const SELECTION_RING = new SimpleMarkerSymbol({
  style: 'circle',
  size: 24,
  color: [0, 0, 0, 0],
  outline: { color: [21, 122, 90], width: 2.5 },
});

const CENTER_FALLBACK: LonLat = [31.0, 49.3];
/** Скільки чекаємо на готовність MapView, перш ніж показати карту без підкладки. */
const VIEW_TIMEOUT_MS = 8000;
/** Скільки чекаємо на веб-карту Portal, перш ніж перейти до базової карти. */
const WEBMAP_TIMEOUT_MS = 15000;

type MapMode = 'webmap' | 'fallback';

interface MedicalTarget {
  layer: Layer | Sublayer;
  objectIdField: string;
  /** Початковий вираз шару у веб-карті, який не можна губити. */
  baseExpression: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

/** Чи це шар медичних закладів (за назвою або URL сервісу). */
function isMedicalLayer(candidate: { title?: string | null; url?: string | null }): boolean {
  const title = (candidate.title ?? '').toLowerCase();
  if (title.includes('medical') && title.includes('facilit')) return true;
  const url = (candidate.url ?? '').toLowerCase();
  return url.length > 0 && url.startsWith(appConfig.services.facilities.url.toLowerCase());
}

/**
 * Ховає всі шари веб-карти, крім «Medical facilities». Групи лишаються
 * видимими, якщо всередині є медичний шар; у MapImageLayer видимими
 * лишаються тільки медичні підшари.
 */
function isolateMedicalLayers(layers: Collection<Layer>): boolean {
  let anyVisible = false;
  layers.forEach((layer) => {
    // Шар сервісу закладів може бути цілим MapImageLayer — тоді лишаємо його підшари.
    const layerMatch = isMedicalLayer(layer);
    let visible = layerMatch;
    if (layer.type === 'group') {
      visible = isolateMedicalLayers((layer as GroupLayer).layers) || layerMatch;
    } else if (layer.type === 'map-image') {
      let visibleSublayer = false;
      (layer as MapImageLayer).sublayers?.forEach((sublayer) => {
        const match = layerMatch || isMedicalLayer(sublayer);
        sublayer.visible = match;
        visibleSublayer = visibleSublayer || match;
      });
      visible = layerMatch || visibleSublayer;
    }
    layer.visible = visible;
    anyVisible = anyVisible || visible;
  });
  return anyVisible;
}

/** Знаходить шар медичних закладів для фільтрації та визначення OBJECTID. */
function findMedicalTarget(layers: Collection<Layer>): MedicalTarget | null {
  const items = layers.toArray();
  for (const layer of items) {
    if (layer.type === 'group') {
      const nested = findMedicalTarget((layer as GroupLayer).layers);
      if (nested) return nested;
      continue;
    }
    if (layer.type === 'map-image') {
      const mapImage = layer as MapImageLayer;
      for (const sublayer of mapImage.sublayers?.toArray() ?? []) {
        if (isMedicalLayer(sublayer)) {
          return {
            layer: sublayer,
            objectIdField: 'objectid',
            baseExpression: sublayer.definitionExpression ?? '',
          };
        }
      }
    }
    if (layer.type === 'feature' && isMedicalLayer(layer)) {
      const featureLayer = layer as FeatureLayer;
      return {
        layer,
        objectIdField: featureLayer.objectIdField || 'objectid',
        baseExpression: featureLayer.definitionExpression ?? '',
      };
    }
  }
  return null;
}

/** OBJECTID з атрибутів графіка (назва поля у різних шарах відрізняється). */
function readObjectId(attributes: Record<string, unknown>, field: string): number | undefined {
  const direct = attributes[field];
  const directNumber = typeof direct === 'number' ? direct : Number(direct);
  if (direct !== undefined && direct !== null && Number.isFinite(directNumber)) return directNumber;
  for (const [key, value] of Object.entries(attributes)) {
    if (!key.toLowerCase().endsWith('objectid')) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Реєструє токен Portal для веб-карти та пов'язаних сервісів. */
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

/**
 * Підбирає центр і масштаб, щоб усі заклади вмістилися у вікні карти.
 *
 * Extent шару графіки в ArcGIS SDK 5 повертає весь світ, тому масштаб
 * рахуємо від реальних розмірів viewport і розкиду координат.
 */
function fitView(
  points: LonLat[],
  width: number,
  height: number,
): { center: LonLat; zoom: number } | null {
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
  // Мінімальний розкид, щоб не «прилипати» до максимального масштабу
  // через одну точку або дуже близькі заклади.
  const lonSpan = Math.max(maxLon - minLon, 0.02);
  const latSpan = Math.max(maxLat - minLat, 0.02);
  const meanLatRad = (center[1] * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(meanLatRad), 0.2);
  const safeWidth = Math.max(width, 240);
  const safeHeight = Math.max(height, 200);
  const zoomLon = Math.log2((safeWidth * 0.86 * 360) / (256 * lonSpan));
  const zoomLat = Math.log2((safeHeight * 0.86 * 360 * cosLat) / (256 * latSpan));
  const zoom = Math.min(13, Math.max(4, Math.min(zoomLon, zoomLat)));
  return { center, zoom };
}

/**
 * Оглядова карта медичних закладів (сторінка «Медичні заклади»).
 *
 * У режимі Portal карта будується з веб-карти `appConfig.webMapId`: з неї
 * береться шар «Medical facilities» (разом з його умовними знаками), а всі
 * інші шари ховаються. Без токена (демо-режим) використовується базова
 * карта з маркерами застосунку.
 *
 * Клік по об'єкту вибирає заклад; вибір у списку підсвічується на карті.
 */
export function FacilitiesMap({
  facilities,
  selectedId,
  onSelect,
  filterActive = false,
}: FacilitiesMapProps) {
  const { session } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const viewRef = useRef<MapView | null>(null);
  const graphicsRef = useRef<GraphicsLayer | null>(null);
  const highlightRef = useRef<GraphicsLayer | null>(null);
  const targetRef = useRef<MedicalTarget | null>(null);
  const modeRef = useRef<MapMode>('fallback');
  const facilitiesRef = useRef<FacilityRecord[]>(facilities);
  const selectedRef = useRef<string | null>(selectedId);
  const filterActiveRef = useRef(filterActive);
  const onSelectRef = useRef(onSelect);
  const basemapKeyRef = useRef<BasemapKey>('osm');
  const focusedOnceRef = useRef(false);
  const lastCenteredRef = useRef<string | null>(null);
  const [basemapKey, setBasemapKey] = useState<BasemapKey>('osm');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');

  const token = session?.token ?? null;

  facilitiesRef.current = facilities;
  selectedRef.current = selectedId;
  filterActiveRef.current = filterActive;
  onSelectRef.current = onSelect;
  basemapKeyRef.current = basemapKey;

  /** Малює маркери застосунку (демо-режим або резервна карта). */
  const renderGraphics = useCallback(() => {
    const layer = graphicsRef.current;
    if (!layer) return;
    layer.removeAll();
    if (modeRef.current !== 'fallback') return;
    facilitiesRef.current.forEach((facility) => {
      if (!facility.location) return;
      const selected = facility.id === selectedRef.current;
      layer.add(
        new Graphic({
          geometry: {
            type: 'point',
            longitude: facility.location[0],
            latitude: facility.location[1],
          },
          symbol: selected
            ? SELECTED_SYMBOL
            : isVisitStale(facility.lastVisitDate)
              ? STALE_SYMBOL
              : VERIFIED_SYMBOL,
          attributes: { facilityId: facility.id },
        }),
      );
    });
  }, []);

  /** Кільце вибраного закладу поверх шару веб-карти. */
  const renderHighlight = useCallback(() => {
    const layer = highlightRef.current;
    if (!layer) return;
    layer.removeAll();
    if (modeRef.current !== 'webmap') return;
    const facility = facilitiesRef.current.find((item) => item.id === selectedRef.current);
    if (!facility?.location) return;
    layer.add(
      new Graphic({
        geometry: {
          type: 'point',
          longitude: facility.location[0],
          latitude: facility.location[1],
        },
        symbol: SELECTION_RING,
      }),
    );
  }, []);

  /** Фільтрує шар веб-карти за закладами, які зараз видно у списку. */
  const applyLayerFilter = useCallback(() => {
    const target = targetRef.current;
    if (!target) return;
    const holder = target.layer as unknown as { definitionExpression?: string };
    if (!filterActiveRef.current) {
      if (holder.definitionExpression !== target.baseExpression) {
        holder.definitionExpression = target.baseExpression;
      }
      return;
    }
    const ids = facilitiesRef.current
      .map((facility) => facility.objectId)
      .filter((id): id is number => typeof id === 'number');
    const idExpression = ids.length > 0 ? `${target.objectIdField} IN (${ids.join(',')})` : '1=0';
    const expression = target.baseExpression
      ? `(${target.baseExpression}) AND (${idExpression})`
      : idExpression;
    if (holder.definitionExpression !== expression) {
      holder.definitionExpression = expression;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let view: MapView | null = null;

    const focusAll = () => {
      if (!view || focusedOnceRef.current) return;
      focusedOnceRef.current = true;
      const points = facilitiesRef.current
        .map((facility) => facility.location)
        .filter((point): point is LonLat => point !== undefined);
      const viewport = fitView(points, view.width, view.height);
      if (viewport) void view.goTo(viewport);
    };

    const wireView = (nextView: MapView) => {
      nextView.on('click', (event: { x: number; y: number }) => {
        void nextView
          .hitTest(event)
          .then((response) => {
            for (const result of response.results) {
              if (result.type !== 'graphic') continue;
              const attributes = result.graphic?.attributes ?? {};
              const directId = attributes.facilityId;
              if (typeof directId === 'string') {
                onSelectRef.current(directId);
                return;
              }
              const objectId = readObjectId(
                attributes,
                targetRef.current?.objectIdField ?? 'objectid',
              );
              if (objectId === undefined) continue;
              const facility = facilitiesRef.current.find((item) => item.objectId === objectId);
              if (facility) {
                onSelectRef.current(facility.id);
                return;
              }
            }
          })
          .catch(() => undefined);
      });
    };

    const startFallback = (reason?: string) => {
      if (cancelled || !containerRef.current) return;
      setNotice(reason ?? '');
      const map = new Map({ basemap: createBasemap(basemapKeyRef.current) });
      const graphics = new GraphicsLayer({ listMode: 'hide' });
      map.add(graphics);
      graphicsRef.current = graphics;
      mapRef.current = map;
      modeRef.current = 'fallback';

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
        (window as unknown as Record<string, unknown>).__facilitiesMapView = view;
      }
      wireView(view);

      void view
        .when()
        .then(() => {
          if (cancelled) return;
          renderGraphics();
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
        // Даємо React StrictMode завершити пробний unmount, щоб не створювати
        // й одразу не переривати завантаження підкладки (AbortError).
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled || !containerRef.current) return;

        if (!token) {
          startFallback('Демо-режим: веб-карта Portal потребує входу.');
          return;
        }

        try {
          registerPortalToken(token, session?.expiresAt ?? 0);
          const webmap = new WebMap({ portalItem: { id: appConfig.webMapId } });
          const loaded = await withTimeout(webmap.load(), WEBMAP_TIMEOUT_MS);
          if (cancelled) return;
          if (!loaded) throw new Error('Portal не відповів на запит веб-карти');

          const hasTarget = isolateMedicalLayers(webmap.layers);
          if (!hasTarget) throw new Error('У веб-карті не знайдено шар медичних закладів');
          targetRef.current = findMedicalTarget(webmap.layers);

          const highlight = new GraphicsLayer({ listMode: 'hide' });
          webmap.add(highlight);
          highlightRef.current = highlight;
          mapRef.current = webmap;
          modeRef.current = 'webmap';

          if (!containerRef.current) return;
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
            (window as unknown as Record<string, unknown>).__facilitiesMapView = view;
          }
          wireView(view);

          await withTimeout(view.when(), VIEW_TIMEOUT_MS);
          if (cancelled) return;

          webmap.basemap = createBasemap(basemapKeyRef.current);
          const legend = new Legend({ view });
          view.ui.add(legend, 'bottom-right');
          applyLayerFilter();
          setStatus('ready');
          focusAll();
        } catch (cause) {
          if (cancelled) return;
          const reason =
            cause instanceof Error
              ? cause.message
              : 'Невідома помилка завантаження веб-карти';
          view?.destroy();
          view = null;
          viewRef.current = null;
          mapRef.current = null;
          targetRef.current = null;
          startFallback(`Веб-карта Portal недоступна (${reason}). Показано базову карту.`);
        }
      } catch (cause) {
        if (cancelled) return;
        setStatus('error');
        setMessage(cause instanceof Error ? cause.message : 'Невідома помилка карти');
      }
    };

    void start();

    return () => {
      cancelled = true;
      viewRef.current = null;
      mapRef.current = null;
      graphicsRef.current = null;
      highlightRef.current = null;
      targetRef.current = null;
      view?.destroy();
    };
  }, [token, session?.expiresAt, renderGraphics, applyLayerFilter]);

  useEffect(() => {
    renderGraphics();
    renderHighlight();
  }, [facilities, selectedId, renderGraphics, renderHighlight]);

  useEffect(() => {
    applyLayerFilter();
  }, [facilities, filterActive, applyLayerFilter, status]);

  // Перемикання підкладки з випадаючого списку.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    map.basemap = createBasemap(basemapKey);
  }, [basemapKey, status]);

  // Підсвічування зі списку: підводимо карту до вибраного закладу.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || status !== 'ready' || !selectedId) return;
    if (lastCenteredRef.current === selectedId) return;
    const facility = facilitiesRef.current.find((item) => item.id === selectedId);
    if (!facility?.location) return;
    lastCenteredRef.current = selectedId;
    // Якщо заклад уже видно на карті (наприклад, клік по маркеру) — не рухаємо карту.
    const point = new Point({
      longitude: facility.location[0],
      latitude: facility.location[1],
    });
    if (view.extent?.contains(point)) return;
    void view.goTo({ center: facility.location, zoom: Math.max(view.zoom, 10) });
  }, [selectedId, status]);

  return (
    <div className="facility-map-wrap facilities-map">
      <div ref={containerRef} className="facility-map" />
      {status !== 'error' && (
        <div className="facility-map-controls">
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
      {status === 'ready' && modeRef.current === 'webmap' && (
        <span className="facility-map-hint">Шар Medical facilities з веб-карти Portal</span>
      )}
      {status === 'ready' && modeRef.current === 'fallback' && (
        <span className="facility-map-hint">Натисніть на маркер, щоб вибрати заклад</span>
      )}
      {status === 'error' && message && <span className="facility-map-details">{message}</span>}
    </div>
  );
}
