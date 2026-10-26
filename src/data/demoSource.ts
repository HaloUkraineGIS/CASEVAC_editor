import { facilityRecordFromValues, validateFacilityValues } from '../lib/facilitySchema';
import { todayIso } from '../lib/format';
import type {
  DataSnapshot,
  DataSource,
  FacilityDraft,
  FacilityRecord,
  LonLat,
  RouteDraft,
  RouteRecord,
} from '../types';
import { demoSnapshot } from './demoData';
import { demoFacilitySchema } from './demoFacilitySchema';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Локальне джерело даних: працює без Portal, зміни живе лише до перезавантаження
 * сторінки. Використовується для розробки інтерфейсу та демонстрацій.
 */
export function createDemoSource(): DataSource {
  let snapshot: DataSnapshot = clone(demoSnapshot);
  let nextObjectId = 1000;

  const registerMedic = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && !snapshot.medics.includes(trimmed)) snapshot.medics = [...snapshot.medics, trimmed];
  };

  const validate = (draft: FacilityDraft, requireLocation: boolean) => {
    const { errors, firstInvalid } = validateFacilityValues(demoFacilitySchema, draft.attributes);
    if (firstInvalid) throw new Error(errors[firstInvalid] ?? 'Перевірте заповнення форми');
    if (requireLocation && !draft.location) {
      throw new Error('Вкажіть точку закладу на карті або введіть координати.');
    }
  };

  return {
    kind: 'demo',
    label: 'Демо-дані',
    capabilities: {
      createFacility: true,
      editFacility: true,
      deleteFacility: true,
      createRoute: true,
      editRouteGeometry: false,
      writeStartPoints: false,
    },
    load: async () => clone(snapshot),
    createFacility: async (draft: FacilityDraft): Promise<FacilityRecord> => {
      validate(draft, true);
      const objectId = nextObjectId + 1;
      nextObjectId = objectId;
      const facility = facilityRecordFromValues(demoFacilitySchema, draft.attributes, {
        objectId,
        globalId: `f-${objectId}`,
        location: draft.location,
      });
      snapshot.facilities = [facility, ...snapshot.facilities];
      registerMedic(facility.visitedBy);
      return facility;
    },
    updateFacility: async (record: FacilityRecord, draft: FacilityDraft): Promise<FacilityRecord> => {
      validate(draft, false);
      const index = snapshot.facilities.findIndex((item) => item.id === record.id);
      if (index < 0) throw new Error('Заклад не знайдено в поточному списку. Оновіть дані.');
      const updated = facilityRecordFromValues(demoFacilitySchema, draft.attributes, {
        objectId: record.objectId,
        globalId: record.id,
        location: draft.location ?? record.location,
      });
      const facilities = [...snapshot.facilities];
      facilities[index] = updated;
      snapshot.facilities = facilities;
      registerMedic(updated.visitedBy);
      return updated;
    },
    deleteFacility: async (record: FacilityRecord): Promise<void> => {
      const linked = snapshot.routes.filter((route) => route.facilityId === record.id);
      if (linked.length > 0) {
        const codes = linked.map((route) => route.code || route.id).join(', ');
        throw new Error(
          `Заклад пов’язаний із маршрутами (${codes}). Спершу перенесіть або деактивуйте ці маршрути.`,
        );
      }
      snapshot.facilities = snapshot.facilities.filter((item) => item.id !== record.id);
    },
    createRoute: async (draft: RouteDraft): Promise<RouteRecord> => {
      const facility = snapshot.facilities.find((item) => item.id === draft.facilityId);
      if (!facility) throw new Error('Обраний медичний заклад не знайдено');
      const minefield = snapshot.minefields.find((item) => item.taskId === draft.taskId);
      const start: LonLat = minefield?.location ?? [0, 0];
      const end: LonLat = facility.location ?? start;

      const route: RouteRecord = {
        id: `r-${Date.now()}`,
        code: draft.code,
        taskId: draft.taskId,
        facilityId: facility.id,
        facilityName: facility.name,
        routeType: draft.routeType,
        isCurrent: true,
        surveyedBy: draft.surveyedBy,
        surveyDate: draft.surveyDate || todayIso(),
        geometry: [start, end],
      };
      snapshot.routes = [route, ...snapshot.routes];
      snapshot.startPoints = [
        ...snapshot.startPoints,
        { id: `sp-${route.id}`, parentGlobalId: route.id, location: start },
      ];
      registerMedic(draft.surveyedBy);
      return route;
    },
  };
}
