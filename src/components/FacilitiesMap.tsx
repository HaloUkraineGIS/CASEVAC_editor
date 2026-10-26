import { useCallback, useEffect, useRef, useState } from 'react';
import Graphic from '@arcgis/core/Graphic.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import Map from '@arcgis/core/Map.js';
import MapView from '@arcgis/core/views/MapView.js';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol.js';
import { Loader2, MapPinOff } from 'lucide-react';
import '@arcgis/core/assets/esri/themes/light/main.css';
import { isVisitStale } from '../lib/format';
import { createOsmBasemap } from '../lib/osmBasemap';
import type { FacilityRecord, LonLat } from '../types';

interface FacilitiesMapProps {
  /** Заклади, які треба показати (з урахуванням пошуку). */
  facilities: FacilityRecord[];
  /** Вибраний заклад — підсвічується на карті. */
  selectedId: string | null;
  /** Клік по маркеру закладу. */
  onSelect: (id: string) => void;
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

const CENTER_FALLBACK: LonLat = [31.0, 49.3];
/** Скільки чекаємо на готовність MapView, перш ніж показати карту без підкладки. */
const VIEW_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
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
 * Оглядова карта всіх медичних закладів (сторінка «Медичні заклади»).
 *
 * Використовує відкриту підкладку OpenStreetMap, тому не залежить від
 * токена Portal. Клік по маркеру вибирає заклад; вибраний заклад
 * підсвічується, а список синхронізується з картою.
 */
export function FacilitiesMap({ facilities, selectedId, onSelect }: FacilitiesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const layerRef = useRef<GraphicsLayer | null>(null);
  const facilitiesRef = useRef<FacilityRecord[]>(facilities);
  const selectedRef = useRef<string | null>(selectedId);
  const onSelectRef = useRef(onSelect);
  const focusedOnceRef = useRef(false);
  const lastCenteredRef = useRef<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  facilitiesRef.current = facilities;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;

  const renderGraphics = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.removeAll();
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

  useEffect(() => {
    let cancelled = false;
    let view: MapView | null = null;

    const start = async () => {
      try {
        // Даємо React StrictMode завершити пробний unmount, щоб не створювати
        // й одразу не переривати завантаження підкладки (AbortError).
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled || !containerRef.current) return;

        const map = new Map({ basemap: createOsmBasemap() });
        const graphics = new GraphicsLayer({ listMode: 'hide' });
        map.add(graphics);
        layerRef.current = graphics;

        if (cancelled || !containerRef.current) return;
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

        view.on('click', (event) => {
          void view
            ?.hitTest(event)
            .then((response) => {
              for (const result of response.results) {
                if (result.type !== 'graphic') continue;
                const id = result.graphic?.attributes?.facilityId;
                if (typeof id === 'string') {
                  onSelectRef.current(id);
                  break;
                }
              }
            })
            .catch(() => undefined);
        });

        await withTimeout(view.when(), VIEW_TIMEOUT_MS);
        if (cancelled) return;
        renderGraphics();
        setStatus('ready');

        if (!focusedOnceRef.current) {
          focusedOnceRef.current = true;
          const points = facilitiesRef.current
            .map((facility) => facility.location)
            .filter((point): point is LonLat => point !== undefined);
          const viewport = fitView(points, view.width, view.height);
          if (viewport) void view.goTo(viewport);
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
      layerRef.current = null;
      view?.destroy();
    };
  }, [renderGraphics]);

  useEffect(() => {
    renderGraphics();
  }, [facilities, selectedId, renderGraphics]);

  // Підсвічування зі списку: підводимо карту до вибраного закладу.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || status !== 'ready' || !selectedId) return;
    if (lastCenteredRef.current === selectedId) return;
    const facility = facilitiesRef.current.find((item) => item.id === selectedId);
    if (!facility?.location) return;
    lastCenteredRef.current = selectedId;
    void view.goTo({ center: facility.location, zoom: Math.max(view.zoom, 10) });
  }, [selectedId, status]);

  return (
    <div className="facility-map-wrap facilities-map">
      <div ref={containerRef} className="facility-map" />
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
      {status === 'ready' && (
        <span className="facility-map-hint">Натисніть на маркер, щоб вибрати заклад</span>
      )}
      {status === 'error' && message && <span className="facility-map-details">{message}</span>}
    </div>
  );
}
