import type { FacilityRecord } from '../types';

/**
 * Поле «Область» у шарі медичних закладів може називатися по-різному:
 * у демо-схемі — `region`, у сервісах Portal — `oblast` / `oblast_ukr` тощо.
 */
const REGION_KEYS = ['region', 'oblast', 'oblast_ukr', 'region_ukr', 'область'];

/** Значення `selectedRegion`, коли фільтр за областями вимкнений. */
export const ALL_REGIONS = '__all_regions__';

/** Підпис для закладів, у яких поле області порожнє. */
export const UNKNOWN_REGION_LABEL = 'Область не вказана';

export interface RegionGroup {
  /** Значення області (або `UNKNOWN_REGION_LABEL` для порожніх). */
  region: string;
  facilities: FacilityRecord[];
}

/** Читає область закладу з його атрибутів; повертає порожній рядок, якщо її немає. */
export function readFacilityRegion(facility: FacilityRecord): string {
  const attributes = facility.attributes ?? {};
  const normalized = new Map<string, unknown>();
  Object.entries(attributes).forEach(([key, value]) => {
    normalized.set(key.toLowerCase(), value);
  });

  for (const key of REGION_KEYS) {
    const value = normalized.get(key);
    if (typeof value !== 'string') continue;
    const text = value.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

/** Групує заклади за областю; порожні значення збираються в окремий рядок. */
export function groupFacilitiesByRegion(facilities: FacilityRecord[]): RegionGroup[] {
  const groups = new Map<string, FacilityRecord[]>();
  facilities.forEach((facility) => {
    const region = readFacilityRegion(facility) || UNKNOWN_REGION_LABEL;
    const current = groups.get(region);
    if (current) {
      current.push(facility);
    } else {
      groups.set(region, [facility]);
    }
  });

  return [...groups.entries()]
    .map(([region, list]) => ({ region, facilities: list }))
    .sort((left, right) => {
      if (left.region === UNKNOWN_REGION_LABEL) return 1;
      if (right.region === UNKNOWN_REGION_LABEL) return -1;
      return left.region.localeCompare(right.region, 'uk');
    });
}

/** Заклади вибраної області (або всі, якщо вибрано `ALL_REGIONS`). */
export function filterFacilitiesByRegion(
  facilities: FacilityRecord[],
  region: string,
): FacilityRecord[] {
  if (region === ALL_REGIONS) return facilities;
  if (region === UNKNOWN_REGION_LABEL) {
    return facilities.filter((facility) => !readFacilityRegion(facility));
  }
  return facilities.filter((facility) => readFacilityRegion(facility) === region);
}
