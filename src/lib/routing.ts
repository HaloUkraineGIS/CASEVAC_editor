/**
 * Побудова маршруту між двома точками.
 *
 * Основний провайдер — ArcGIS Network Analysis на Portal (Route_World).
 * Публічний OSRM доступний лише як явно вибраний варіант для демо/розробки.
 * Якщо сервіс недоступний, повертається пряма лінія з ознакою `fallback`,
 * щоб користувач міг відредагувати її вручну.
 */

import Point from '@arcgis/core/geometry/Point.js';
import type Polyline from '@arcgis/core/geometry/Polyline.js';
import { xyToLngLat } from '@arcgis/core/geometry/support/webMercatorUtils.js';
import Graphic from '@arcgis/core/Graphic.js';
import { solve } from '@arcgis/core/rest/route.js';
import FeatureSet from '@arcgis/core/rest/support/FeatureSet.js';
import RouteParameters from '@arcgis/core/rest/support/RouteParameters.js';
import { appConfig } from '../config/appConfig';
import { distanceMeters, polylineLengthKm } from './format';
import type { LonLat } from '../types';

export type RoutingProvider = 'arcgis' | 'osrm';

export interface RouteSolution {
  geometry: LonLat[];
  distanceKm: number;
  durationMin: number;
  provider: RoutingProvider;
  /** true — маршрут не побудовано, повернуто пряму лінію. */
  fallback: boolean;
  /** Причина переходу на пряму лінію (для повідомлення користувачу). */
  error?: string;
}

export interface SolveRouteOptions {
  from: LonLat;
  to: LonLat;
  provider?: RoutingProvider;
  token?: string | null;
  signal?: AbortSignal;
}

interface RawSolution {
  geometry: LonLat[];
  distanceKm: number;
  durationMin: number;
  provider: RoutingProvider;
}

/** Метри на один градус — достатньо для локального спрощення геометрії. */
const METERS_PER_DEGREE_LAT = 110_574;
const METERS_PER_DEGREE_LON = 111_320;

function isWebMercator(spatialReference: {
  wkid?: number;
  latestWkid?: number;
  isWebMercator?: boolean;
} | null | undefined): boolean {
  if (!spatialReference) return false;
  return (
    spatialReference.isWebMercator === true ||
    spatialReference.wkid === 3857 ||
    spatialReference.wkid === 102100 ||
    spatialReference.latestWkid === 3857 ||
    spatialReference.latestWkid === 102100
  );
}

/** Перетворює геометрію полілінії ArcGIS у масив [довгота, широта]. */
function polylineToLonLat(polyline: Polyline): LonLat[] {
  const mercator = isWebMercator(polyline.spatialReference as never);
  return (polyline.paths ?? [])
    .flat()
    .map(([x, y]) => {
      const lon = Number(x);
      const lat = Number(y);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return mercator ? (xyToLngLat(lon, lat) as LonLat) : ([lon, lat] as LonLat);
    })
    .filter((point): point is LonLat => point !== null);
}

function stopGraphic([lon, lat]: LonLat): Graphic {
  return new Graphic({
    geometry: new Point({
      longitude: lon,
      latitude: lat,
      spatialReference: { wkid: 4326 },
    }),
  });
}

/** Маршрут через ArcGIS Network Analysis (Portal). */
async function solveWithArcgis(
  from: LonLat,
  to: LonLat,
  token: string | null,
  signal: AbortSignal,
): Promise<RawSolution> {
  const params = new RouteParameters({
    stops: new FeatureSet({ features: [stopGraphic(from), stopGraphic(to)] }),
    outSpatialReference: { wkid: 4326 },
    returnRoutes: true,
    returnDirections: false,
    impedanceAttribute: 'TravelTime',
  });

  // Route_World опублікований на захищеному Portal, тому без входу запит
  // приречений. Повертаємо зрозумілу причину замість «ABORTED» від SDK.
  if (!token) {
    throw new Error('для маршрутизації ArcGIS потрібен вхід через Portal');
  }

  // SDK формує query самостійно й не зберігає requestOptions.query, тому
  // токен додаємо в URL сервісу — інакше запит поверне 403.
  const url = `${appConfig.routing.arcgisUrl}?token=${encodeURIComponent(token)}`;

  const result = await solve(url, params, { signal });
  const routeGraphic = result.routeResults?.[0]?.route;
  if (!routeGraphic) throw new Error('Сервіс маршрутизації не повернув маршрут');

  const geometry = polylineToLonLat(routeGraphic.geometry as Polyline);
  if (geometry.length < 2) throw new Error('Сервіс маршрутизації повернув порожню геометрію');

  const attributes = (routeGraphic.attributes ?? {}) as Record<string, unknown>;
  const distanceValue = Number(attributes.Total_Kilometers ?? attributes.Total_Length);
  const durationValue = Number(attributes.Total_TravelTime ?? attributes.TravelTime);

  return {
    geometry,
    distanceKm:
      Number.isFinite(distanceValue) && distanceValue > 0
        ? distanceValue
        : polylineLengthKm(geometry),
    durationMin: Number.isFinite(durationValue) && durationValue > 0 ? durationValue : 0,
    provider: 'arcgis',
  };
}

interface OsrmResponse {
  code?: string;
  message?: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
  }[];
}

/** Маршрут через публічний (або власний) OSRM. */
async function solveWithOsrm(from: LonLat, to: LonLat, signal: AbortSignal): Promise<RawSolution> {
  const base = appConfig.routing.osrmUrl;
  const url =
    `${base}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}` +
    '?overview=full&geometries=geojson';

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`OSRM повернув HTTP ${response.status}`);

  const payload = (await response.json()) as OsrmResponse;
  const route = payload.routes?.[0];
  if (payload.code !== 'Ok' || !route) {
    throw new Error(payload.message || `OSRM: ${payload.code || 'маршрут не знайдено'}`);
  }

  const geometry = route.geometry.coordinates
    .map(([lon, lat]) => [Number(lon), Number(lat)] as LonLat)
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (geometry.length < 2) throw new Error('OSRM повернув порожню геометрію');

  return {
    geometry,
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
    provider: 'osrm',
  };
}

function projectPoint([lon, lat]: LonLat, cosLat: number): [number, number] {
  return [lon * METERS_PER_DEGREE_LON * cosLat, lat * METERS_PER_DEGREE_LAT];
}

function distanceToSegmentSquared(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    const px = point[0] - start[0];
    const py = point[1] - start[1];
    return px * px + py * py;
  }

  let t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const offsetX = point[0] - (start[0] + t * dx);
  const offsetY = point[1] - (start[1] + t * dy);
  return offsetX * offsetX + offsetY * offsetY;
}

/**
 * Спрощення геометрії алгоритмом Дугласа–Пекера в метрах.
 * Перша й остання точки завжди зберігаються.
 */
export function simplifyRoute(points: LonLat[], toleranceMeters: number): LonLat[] {
  if (points.length <= 2 || toleranceMeters <= 0) return points;

  const cosLat = Math.cos((((points[0][1] + points[points.length - 1][1]) / 2) * Math.PI) / 180);
  const projected = points.map((point) => projectPoint(point, cosLat));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const toleranceSquared = toleranceMeters * toleranceMeters;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let maxDistanceSquared = -1;
    let farthest = -1;

    for (let index = start + 1; index < end; index += 1) {
      const distanceSquared = distanceToSegmentSquared(
        projected[index],
        projected[start],
        projected[end],
      );
      if (distanceSquared > maxDistanceSquared) {
        maxDistanceSquared = distanceSquared;
        farthest = index;
      }
    }

    if (maxDistanceSquared > toleranceSquared && farthest > start) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

/** Прив'язує першу й останню точку рівно до початку та закладу. */
function anchorEndpoints(points: LonLat[], from: LonLat, to: LonLat): LonLat[] {
  const geometry = points.filter(
    ([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat),
  );
  if (geometry.length === 0) return [from, to];

  if (distanceMeters(geometry[0], from) <= 3) geometry[0] = from;
  else geometry.unshift(from);

  const lastIndex = geometry.length - 1;
  if (distanceMeters(geometry[lastIndex], to) <= 3) geometry[lastIndex] = to;
  else geometry.push(to);

  return geometry;
}

/**
 * Витягує зрозуміле повідомлення з будь-якої помилки.
 *
 * SDK ArcGIS кидає не `Error`, а власний об'єкт `{ name, message, details }`,
 * тому звичайна перевірка `instanceof Error` втрачає причину.
 */
function describeRoutingError(cause: unknown): string {
  if (cause instanceof Error) {
    if (cause.name === 'AbortError') return 'сервіс не відповів вчасно';
    return cause.message || 'невідома помилка';
  }

  if (typeof cause === 'object' && cause !== null) {
    const record = cause as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : '';
    if (name === 'AbortError' || name === 'ABORTED') return 'сервіс не відповів вчасно';
    const message = record.message;
    if (typeof message === 'string' && message.trim()) {
      if (message === 'ABORTED') return 'сервіс не відповів вчасно';
      const status = typeof record.httpStatus === 'number' ? ` (HTTP ${record.httpStatus})` : '';
      return `${message}${status}`;
    }
    const details = record.details;
    if (Array.isArray(details)) {
      const text = details.filter((item) => typeof item === 'string').join('; ');
      if (text) return text;
    }
  }

  const text = String(cause ?? '').trim();
  return text || 'невідома помилка';
}

/**
 * Будує маршрут і ніколи не кидає помилку через недоступність сервісу:
 * у такому разі повертає пряму лінію з `fallback: true`.
 * Скасування виклику через `signal` пробрасується назовні.
 */
export async function solveRoute(options: SolveRouteOptions): Promise<RouteSolution> {
  const { from, to } = options;
  const provider = options.provider ?? appConfig.routing.provider;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), appConfig.routing.timeoutMs);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const raw =
      provider === 'osrm'
        ? await solveWithOsrm(from, to, controller.signal)
        : await solveWithArcgis(from, to, options.token ?? null, controller.signal);

    const anchored = anchorEndpoints(raw.geometry, from, to);
    const simplified = simplifyRoute(anchored, appConfig.routing.simplifyToleranceMeters);

    return {
      ...raw,
      geometry: anchorEndpoints(simplified, from, to),
      fallback: false,
    };
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    return {
      geometry: [from, to],
      distanceKm: distanceMeters(from, to) / 1000,
      durationMin: 0,
      provider,
      fallback: true,
      error: describeRoutingError(cause),
    };
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}
