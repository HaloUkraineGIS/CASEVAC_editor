import type { FacilityRecord, FacilitySchema } from '../types';
import { displayFieldValue } from './facilitySchema';

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
  /** Доменне значення області (або `UNKNOWN_REGION_LABEL` для порожніх). */
  region: string;
  facilities: FacilityRecord[];
}

/** Назви полів, які можуть містити область, з урахуванням підпису «Область». */
function regionCandidates(schema: FacilitySchema | null | undefined): string[] {
  const names = [...REGION_KEYS];
  schema?.fields.forEach((field) => {
    const name = field.name.trim();
    if (!name) return;
    if (
      field.alias.trim().toLowerCase() === 'область' ||
      REGION_KEYS.includes(name.toLowerCase())
    ) {
      names.unshift(name);
    }
  });
  return [...new Set(names.map((name) => name.toLowerCase()))];
}

/**
 * Читає область закладу з його атрибутів.
 *
 * Якщо передана схема шару, код домену замінюється доменним підписом —
 * у списку й документі має бути «Київська», а не `1` чи `KYIV`.
 */
export function readFacilityRegion(
  facility: FacilityRecord,
  schema?: FacilitySchema | null,
): string {
  const attributes = facility.attributes ?? {};
  const normalized = new Map<string, { key: string; value: unknown }>();
  Object.entries(attributes).forEach(([key, value]) => {
    normalized.set(key.toLowerCase(), { key, value });
  });

  for (const candidate of regionCandidates(schema)) {
    const entry = normalized.get(candidate);
    if (!entry) continue;
    const value = entry.value;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const raw = String(value).replace(/\s+/g, ' ').trim();
    if (!raw) continue;

    const field = schema?.fields.find(
      (item) => item.name.toLowerCase() === entry.key.toLowerCase(),
    );
    const label = field ? displayFieldValue(field, value).trim() : raw;
    if (label) return label;
  }
  return '';
}

/** Групує заклади за областю; порожні значення збираються в окремий рядок. */
export function groupFacilitiesByRegion(
  facilities: FacilityRecord[],
  schema?: FacilitySchema | null,
): RegionGroup[] {
  const groups = new Map<string, FacilityRecord[]>();
  facilities.forEach((facility) => {
    const region = readFacilityRegion(facility, schema) || UNKNOWN_REGION_LABEL;
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
  schema?: FacilitySchema | null,
): FacilityRecord[] {
  if (region === ALL_REGIONS) return facilities;
  if (region === UNKNOWN_REGION_LABEL) {
    return facilities.filter((facility) => !readFacilityRegion(facility, schema));
  }
  return facilities.filter((facility) => readFacilityRegion(facility, schema) === region);
}
