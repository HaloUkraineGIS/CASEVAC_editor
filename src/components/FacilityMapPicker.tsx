import { useCallback, useEffect, useRef, useState } from 'react';
import Graphic from '@arcgis/core/Graphic.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import Map from '@arcgis/core/Map.js';
import MapView from '@arcgis/core/views/MapView.js';
import { xyToLngLat } from '@arcgis/core/geometry/support/webMercatorUtils.js';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol.js';
import { Crosshair, Loader2, MapPinOff } from 'lucide-react';
import '@arcgis/core/assets/esri/themes/light/main.css';
import { formatCoordinatePair } from '../lib/format';
import { createOsmBasemap } from '../lib/osmBasemap';
import type { FacilityRecord, LonLat } from '../types';

interface FacilityMapPickerProps {
  /** Поточна точка закладу. */
  point?: LonLat;
  /** Інші заклади для орієнтира на карті. */
  facilities: FacilityRecord[];
  /** Вибір точки кліком на карті. */
  onPick: (point: LonLat) => void;
}

const FACILITY_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 9,
  color: [48, 116, 88],
  outline: { color: [255, 255, 255], width: 1.5 },
});

/** Скільки чекаємо, перш ніж показати карту з графікою навіть без підкладки. */
const VIEW_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

const SELECTED_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 17,
  color: [190, 92, 71],
  outline: { color: [255, 255, 255], width: 2 },
});

function pointGraphic(point: LonLat, symbol: SimpleMarkerSymbol): Graphic {
  return new Graphic({
    geometry: { type: 'point', longitude: point[0], latitude: point[1] },
    symbol,
  });
}

/**
 * Карта для вибору точки закладу (FR-10).
 *
 * У режимі Portal використовується веб-карта з налаштувань застосунку,
 * у демо-режимі — доступна підкладка ArcGIS. Якщо карта недоступна,
 * форма залишає ручне введення координат.
 */
export function FacilityMapPicker({ point, facilities, onPick }: FacilityMapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const layerRef = useRef<GraphicsLayer | null>(null);
  const pointRef = useRef<LonLat | undefined>(point);
  const facilitiesRef = useRef<FacilityRecord[]>(facilities);
  const onPickRef = useRef(onPick);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  pointRef.current = point;
  facilitiesRef.current = facilities;
  onPickRef.current = onPick;

  const renderGraphics = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.removeAll();
    facilitiesRef.current.forEach((facility) => {
      if (!facility.location) return;
      layer.add(pointGraphic(facility.location, FACILITY_SYMBOL));
    });
    if (pointRef.current) {
      layer.add(pointGraphic(pointRef.current, SELECTED_SYMBOL));
    }
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

        // Для вибору точки достатньо відкритої підкладки: робочі шари Portal
        // тут не потрібні, а спроба завантажити веб-карту з невалідним токеном
        // відкриває діалог входу Esri й блокує форму. Тому використовуємо OSM.
        const map = new Map({ basemap: createOsmBasemap() });

        if (cancelled || !containerRef.current) return;
        const graphics = new GraphicsLayer({ listMode: 'hide' });
        map.add(graphics);
        layerRef.current = graphics;

        view = new MapView({
          container: containerRef.current,
          map,
          center: pointRef.current ?? [31.0, 49.3],
          zoom: pointRef.current ? 12 : 6,
          popupEnabled: false,
          ui: { components: ['zoom', 'compass'] },
        });
        viewRef.current = view;

        view.on('click', (event: { mapPoint?: { x: number; y: number } | null }) => {
          const mapPoint = event.mapPoint;
          if (!mapPoint) return;
          const [lon, lat] = xyToLngLat(mapPoint.x, mapPoint.y);
          onPickRef.current([lon, lat]);
        });

        await withTimeout(view.when(), VIEW_TIMEOUT_MS);
        if (cancelled) return;
        renderGraphics();
        setStatus('ready');
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
  }, [point, facilities, renderGraphics]);

  const focusPoint = () => {
    const view = viewRef.current;
    if (!view || !point) return;
    void view.goTo({ center: point, zoom: Math.max(view.zoom, 13) });
  };

  return (
    <div className="facility-map-wrap">
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
          <span>Карту не вдалося завантажити. Введіть координати вручну.</span>
        </div>
      )}
      {status === 'ready' && (
        <>
          <span className="facility-map-hint">Клікніть на карті, щоб поставити точку закладу</span>
          {point && (
            <button type="button" className="facility-map-focus" onClick={focusPoint} title="Наблизити до точки">
              <Crosshair size={14} />
              {formatCoordinatePair(point)}
            </button>
          )}
        </>
      )}
      {status === 'error' && message && <span className="facility-map-details">{message}</span>}
    </div>
  );
}
