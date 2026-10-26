import { appConfig } from '../config/appConfig';
import type { LonLat, RouteRecord, RouteType } from '../types';

/** Поточна дата у форматі ISO (yyyy-mm-dd), локальний час. */
export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  // ISO або будь-який формат, який розуміє Date
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  // dd.mm.yyyy — формат, що використовувався у прототипі
  const dotted = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotted) {
    const [, day, month, year] = dotted;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Дата у форматі ДД.ММ.РРРР. */
export function formatDate(value: string | undefined | null, fallback = '—'): string {
  const date = parseDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Скільки повних місяців минуло з дати (null — дата некоректна). */
export function monthsSince(value: string | undefined | null): number | null {
  const date = parseDate(value);
  if (!date) return null;
  const now = new Date();
  const months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  const dayShift = now.getDate() < date.getDate() ? -1 : 0;
  return Math.max(0, months + dayShift);
}

/** Чи вважається заклад таким, що давно не відвідували (FR-12). */
export function isVisitStale(
  lastVisitDate: string | undefined | null,
  thresholdMonths = appConfig.facilities.visitStaleMonths,
): boolean {
  const months = monthsSince(lastVisitDate);
  return months === null ? true : months >= thresholdMonths;
}

export function routeTypeLabel(type: RouteType): string {
  return type === 'main' ? 'Основний' : 'Додатковий';
}

export function routeStatusLabel(route: Pick<RouteRecord, 'isCurrent'>): string {
  return route.isCurrent ? 'Актуальний' : 'Неактуальний';
}

/** Колір маркера/лінії маршруту, що використовується в інтерфейсі. */
export function routeColor(route: Pick<RouteRecord, 'isCurrent' | 'routeType'>): 'green' | 'blue' | 'gray' {
  if (!route.isCurrent) return 'gray';
  return route.routeType === 'main' ? 'green' : 'blue';
}

export function initials(name: string | undefined | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Координати у форматі десяткових градусів: «50.4021° N, 30.2914° E». */
export function formatCoordinates([lon, lat]: LonLat): string {
  const latLabel = lat >= 0 ? 'N' : 'S';
  const lonLabel = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latLabel}, ${Math.abs(lon).toFixed(4)}° ${lonLabel}`;
}

/** Координати парою: «50.4021, 30.2914» (широта, довгота). */
export function formatCoordinatePair([lon, lat]: LonLat): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/** Відстань між двома точками у метрах (формула гаверсинуса). */
export function distanceMeters(a: LonLat, b: LonLat): number {
  const R = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
