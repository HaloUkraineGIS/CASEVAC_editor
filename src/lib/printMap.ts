/**
 * Карти для аркуша експорту (основна та врізка із закладом).
 *
 * Обидві карти — окремі MapView з підкладкою Esri World Imagery. На них
 * показуємо лише те, що потрібно на аркуші: маршрут, заклад і початкову точку.
 * Жодних сервісів Portal не потрібно — геометрія береться з поточного маршруту.
 */

import Basemap from '@arcgis/core/Basemap.js';
import Graphic from '@arcgis/core/Graphic.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import TileLayer from '@arcgis/core/layers/TileLayer.js';
import Map from '@arcgis/core/Map.js';
import MapView from '@arcgis/core/views/MapView.js';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol.js';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol.js';
import { distanceMeters } from './format';
import { niceScale } from './printLayout';
import type { LonLat } from '../types';

const ESRI_WORLD_IMAGERY =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';

const ROUTE_SYMBOL = new SimpleLineSymbol({
  color: [229, 57, 53, 1],
  width: 2.4,
  cap: 'round',
  join: 'round',
});

const FACILITY_SYMBOL = new SimpleMarkerSymbol({
  style: 'circle',
  size: 14,
  color: [45, 111, 191, 1],
  outline: { color: [255, 255, 255, 1], width: 2 },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FACILITY_LETTER: any = {
  type: 'text',
  text: 'H',
  color: [255, 255, 255, 1],
  font: { size: 9, weight: 'bold', family: 'Arial' },
};

const START_SYMBOL = new SimpleMarkerSymbol({
  style: 'cross',
  size: 13,
  color: [17, 17, 17, 1],
  outline: { color: [17, 17, 17, 1], width: 2 },
});

const LABEL_COLOR = [255, 222, 89, 1];
const LABEL_HALO = [0, 0, 0, 0.85];

export interface SheetMapOptions {
  routeGeometry: LonLat[];
  facilityPoint: LonLat;
  /** Підпис початкової точки (код ділянки). */
  startLabel: string;
  /** Підпис закладу на основній карті. */
  facilityLabel: string;
  /** Показувати текстові підписи (на врізці вони зайві). */
  showLabels: boolean;
  center: LonLat;
  scale: number;
}

function imageryBasemap(): Basemap {
  return new Basemap({
    baseLayers: [new TileLayer({ url: ESRI_WORLD_IMAGERY, title: 'Esri World Imagery' })],
    title: 'Esri Satellite',
  });
}

function buildGraphics(options: SheetMapOptions): Graphic[] {
  const graphics: Graphic[] = [];
  const { routeGeometry, facilityPoint, showLabels } = options;

  if (routeGeometry.length >= 2) {
    graphics.push(
      new Graphic({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geometry: {
          type: 'polyline',
          paths: [routeGeometry.map(([lon, lat]) => [lon, lat])],
          spatialReference: { wkid: 4326 },
        } as any,
        symbol: ROUTE_SYMBOL,
      }),
    );
  }

  graphics.push(
    new Graphic({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      geometry: {
        type: 'point',
        longitude: facilityPoint[0],
        latitude: facilityPoint[1],
        spatialReference: { wkid: 4326 },
      } as any,
      symbol: FACILITY_SYMBOL,
    }),
    new Graphic({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      geometry: {
        type: 'point',
        longitude: facilityPoint[0],
        latitude: facilityPoint[1],
        spatialReference: { wkid: 4326 },
      } as any,
      symbol: FACILITY_LETTER,
    }),
  );

  if (routeGeometry.length > 0) {
    const start = routeGeometry[0];
    graphics.push(
      new Graphic({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geometry: {
          type: 'point',
          longitude: start[0],
          latitude: start[1],
          spatialReference: { wkid: 4326 },
        } as any,
        symbol: START_SYMBOL,
      }),
    );

    if (showLabels && options.startLabel) {
      graphics.push(
        new Graphic({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          geometry: {
            type: 'point',
            longitude: start[0],
            latitude: start[1],
            spatialReference: { wkid: 4326 },
          } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          symbol: {
            type: 'text',
            text: options.startLabel.toUpperCase(),
            color: LABEL_COLOR,
            haloColor: LABEL_HALO,
            haloSize: 1.4,
            font: { size: 11, weight: 'bold', family: 'Arial' },
            yoffset: 14,
          } as any,
        }),
      );
    }
  }

  if (showLabels && options.facilityLabel) {
    graphics.push(
      new Graphic({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geometry: {
          type: 'point',
          longitude: facilityPoint[0],
          latitude: facilityPoint[1],
          spatialReference: { wkid: 4326 },
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        symbol: {
          type: 'text',
          text: options.facilityLabel,
          color: LABEL_COLOR,
          haloColor: LABEL_HALO,
          haloSize: 1.4,
          font: { size: 11, weight: 'bold', family: 'Arial' },
          yoffset: -16,
        } as any,
      }),
    );
  }

  return graphics;
}

/** Створює карту аркуша без елементів керування. */
export function createSheetView(container: HTMLDivElement, options: SheetMapOptions): MapView {
  const layer = new GraphicsLayer({ graphics: buildGraphics(options) });

  return new MapView({
    container,
    map: new Map({ basemap: imageryBasemap(), layers: [layer] }),
    center: options.center,
    scale: options.scale,
    constraints: { rotationEnabled: false, snapToZoom: false },
    popupEnabled: false,
    ui: { components: [] },
    attributionVisible: false,
  });
}

/** Переходить до потрібного центру й масштабу без анімації. */
export async function applyViewScale(
  view: MapView,
  center: LonLat,
  scale: number,
): Promise<void> {
  await view.goTo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { center: center as any, scale },
    { animate: false },
  );
}

/** Центр охоплення геометрії маршруту. */
export function geometryCenter(geometry: LonLat[]): LonLat {
  if (geometry.length === 0) return [31.0, 49.3];
  let minLon = geometry[0][0];
  let maxLon = geometry[0][0];
  let minLat = geometry[0][1];
  let maxLat = geometry[0][1];
  for (const [lon, lat] of geometry) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

/**
 * Типовий масштаб, у який маршрут вміщується на ділянці карти заданого
 * розміру (міліметри аркуша). Округлення — до 1000 / 5000 / 10 000.
 */
export function autoScaleFor(
  geometry: LonLat[],
  frameWidthMm: number,
  frameHeightMm: number,
  padding = 1.12,
): number {
  if (geometry.length < 2) return 25000;

  let minLon = geometry[0][0];
  let maxLon = geometry[0][0];
  let minLat = geometry[0][1];
  let maxLat = geometry[0][1];
  for (const [lon, lat] of geometry) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  const midLon = (minLon + maxLon) / 2;
  const midLat = (minLat + maxLat) / 2;
  const widthMeters = distanceMeters([minLon, midLat], [maxLon, midLat]);
  const heightMeters = distanceMeters([midLon, minLat], [midLon, maxLat]);

  const required = Math.max(
    widthMeters / (frameWidthMm / 1000),
    heightMeters / (frameHeightMm / 1000),
  );

  return niceScale(required * padding);
}

/** Чекає, доки карта завершить перемальовування (для знімка). */
export async function waitForViewIdle(view: MapView, timeoutMs = 15000): Promise<void> {
  const started = Date.now();
  await view.when();
  while (view.updating && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}
