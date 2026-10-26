import { appConfig } from '../config/appConfig';
import {
  buildFacilitySchema,
  capabilitySummary,
  displayFieldValue,
  facilityRecordFromValues,
  fieldByName,
  isFieldEmpty,
  toInputValue,
  validateFacilityValues,
} from '../lib/facilitySchema';
import type {
  DataSnapshot,
  DataSource,
  FacilityDraft,
  FacilityField,
  FacilityRecord,
  FacilitySchema,
  LonLat,
  MinefieldRecord,
  RouteRecord,
  RouteType,
  StartPointRecord,
} from '../types';
import {
  applyEdits,
  describeLayer,
  queryAllFeatures,
  type Feature,
  type LayerInfo,
  type PointGeometry,
} from './arcgisRest';

type FieldMap = Record<string, string | null>;

const ROUTE_CANDIDATES: Record<string, string[]> = {
  taskId: ['task_id', 'taskid'],
  taskCode: ['task_code', 'taskcode'],
  facilityGuid: ['med_facility_guid', 'med_facility_globalid', 'facility_guid'],
  routeType: ['route_type', 'routetype'],
  isCurrent: ['is_current', 'iscurrent', 'actual', 'is_active'],
  surveyedBy: ['surveyed_by', 'surveyedby', 'surveyed', 'created_by_medic'],
  surveyDate: ['survey_date', 'surveydate', 'last_edited_date', 'created_date'],
};

const MINEFIELD_CANDIDATES: Record<string, string[]> = {
  taskId: ['task_id', 'taskid'],
  taskCode: ['task_code', 'taskcode'],
  name: ['name', 'task_name', 'title'],
};

const START_POINT_CANDIDATES: Record<string, string[]> = {
  parentGuid: ['parentglobalid', 'parent_global_id'],
};

function resolveFields(layer: LayerInfo, candidates: Record<string, string[]>): FieldMap {
  const available = new Map(layer.fields.map((field) => [field.name.toLowerCase(), field.name]));
  const resolved: FieldMap = {};
  Object.entries(candidates).forEach(([key, names]) => {
    const match = names.map((name) => available.get(name.toLowerCase())).find(Boolean);
    resolved[key] = match ?? null;
  });
  return resolved;
}

function readValue(attributes: Record<string, unknown>, field: string | null): unknown {
  return field ? attributes[field] : undefined;
}

function readText(attributes: Record<string, unknown>, field: string | null): string {
  const value = readValue(attributes, field);
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function toIsoDate(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const dotted = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dotted) {
      const [, day, month, year] = dotted;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }
  return '';
}

function mapRouteType(value: unknown): RouteType {
  const raw = String(value ?? '').toLowerCase();
  if (raw.includes('додат') || raw.includes('additional') || raw.includes('secondary') || raw === '2') {
    return 'additional';
  }
  return 'main';
}

function mapIsCurrent(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const raw = String(value).trim().toLowerCase();
  return !['ні', 'no', 'false', '0', 'n', 'inactive', 'неактуальний'].includes(raw);
}

function pointFromGeometry(geometry: Record<string, unknown> | null): LonLat | undefined {
  if (!geometry) return undefined;
  const { x, y } = geometry as { x?: unknown; y?: unknown };
  if (typeof x === 'number' && typeof y === 'number') return [x, y];
  return undefined;
}

function lineFromGeometry(geometry: Record<string, unknown> | null): LonLat[] {
  if (!geometry) return [];
  const paths = (geometry as { paths?: unknown }).paths;
  if (!Array.isArray(paths) || paths.length === 0) return [];
  const path = paths[0];
  if (!Array.isArray(path)) return [];
  return path
    .filter((point): point is number[] => Array.isArray(point) && point.length >= 2)
    .map((point) => [Number(point[0]), Number(point[1])] as LonLat);
}

function domainValues(layer: LayerInfo, field: string | null): string[] {
  if (!field) return [];
  const definition = layer.fields.find((item) => item.name === field);
  return (definition?.domain?.codedValues ?? []).map((value) => value.name);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function requireToken(token: string): string {
  if (!token) throw new Error('Немає токена Portal. Увійдіть повторно.');
  return token;
}

function pointGeometry([lon, lat]: LonLat): PointGeometry {
  return { x: lon, y: lat, spatialReference: { wkid: 4326 } };
}

function schemaCapabilities(layer: LayerInfo): FacilitySchema['capabilities'] {
  const enabled = appConfig.services.facilities.editable;
  const capabilities = layer.capabilities.toLowerCase();
  const supports = (name: string) => (capabilities ? capabilities.includes(name) : enabled);
  return {
    create: enabled && supports('create'),
    update: enabled && supports('update'),
    delete: enabled && supports('delete'),
  };
}

function buildFacilitiesSchema(layer: LayerInfo): FacilitySchema {
  return buildFacilitySchema({
    source: 'arcgis',
    title: layer.name || appConfig.services.facilities.title,
    geometryType: layer.geometryType,
    objectIdField: layer.objectIdField,
    globalIdField: layer.globalIdField,
    fields: layer.fields,
    capabilities: schemaCapabilities(layer),
  });
}

function toArcGisValue(field: FacilityField, value: unknown): unknown {
  if (isFieldEmpty(value)) return null;
  if (field.kind === 'number') return Number(value);
  if (field.kind === 'date') {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  if (field.kind === 'coded') {
    const option = field.domain?.options?.find((item) => String(item.value) === String(value));
    return option ? option.value : value;
  }
  return String(value).trim();
}

function buildAttributePayload(
  schema: FacilitySchema,
  values: Record<string, unknown>,
  record?: FacilityRecord,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  if (record?.objectId !== undefined) attributes[schema.objectIdField] = record.objectId;

  schema.fields.forEach((field) => {
    if (!field.editable) return;
    const value = values[field.name];
    if (isFieldEmpty(value)) {
      // Під час оновлення порожнє необов'язкове поле очищаємо явно.
      if (record && !field.required) attributes[field.name] = null;
      return;
    }
    attributes[field.name] = toArcGisValue(field, value);
  });
  return attributes;
}

function assertValid(
  schema: FacilitySchema,
  values: Record<string, unknown>,
  requireLocation: boolean,
  location?: LonLat,
): void {
  const { errors, firstInvalid } = validateFacilityValues(schema, values);
  if (firstInvalid) {
    throw new Error(errors[firstInvalid] ?? 'Перевірте заповнення обов’язкових полів');
  }
  if (requireLocation && schema.geometryType.toLowerCase().includes('point') && !location) {
    throw new Error('Вкажіть точку закладу на карті або введіть координати.');
  }
}

function recordFromValues(
  schema: FacilitySchema,
  values: Record<string, unknown>,
  location: LonLat | undefined,
  objectId: number | undefined,
  globalId: string | undefined,
): FacilityRecord {
  return facilityRecordFromValues(schema, values, { location, objectId, globalId });
}

/**
 * Джерело даних, що читає та редагує шари через ArcGIS REST
 * від імені користувача Portal.
 */
export function createArcGisSource(token: string): DataSource {
  const authToken = requireToken(token);
  let snapshot: DataSnapshot | null = null;
  let facilitySchema: FacilitySchema | null = null;

  const requireSchema = (): FacilitySchema => {
    if (!facilitySchema) throw new Error('Схема шару закладів ще не завантажена. Оновіть дані.');
    return facilitySchema;
  };

  const load = async (): Promise<DataSnapshot> => {
    const notices: string[] = [];

    // Початкові точки й мінні поля — допоміжні шари: якщо вони недоступні
    // або мають неповні метадані, застосунок працює з рештою даних.
    const [routesLayerInfo, facilitiesLayerInfo, minefieldsLayerInfo, startLayerInfo] = await Promise.all([
      describeLayer(appConfig.services.routes.url, authToken),
      describeLayer(appConfig.services.facilities.url, authToken),
      describeLayer(appConfig.services.minefields.url, authToken).catch(() => null),
      describeLayer(appConfig.services.startPoints.url, authToken).catch(() => null),
    ]);

    const [routeFeatures, facilityFeatures, minefieldFeatures, startFeatures] = await Promise.all([
      queryAllFeatures(appConfig.services.routes.url, routesLayerInfo, { token: authToken }),
      queryAllFeatures(appConfig.services.facilities.url, facilitiesLayerInfo, { token: authToken }),
      minefieldsLayerInfo
        ? queryAllFeatures(appConfig.services.minefields.url, minefieldsLayerInfo, {
            token: authToken,
          }).catch(() => [] as Feature[])
        : Promise.resolve([] as Feature[]),
      startLayerInfo
        ? queryAllFeatures(appConfig.services.startPoints.url, startLayerInfo, { token: authToken }).catch(
            () => [] as Feature[],
          )
        : Promise.resolve([] as Feature[]),
    ]);

    facilitySchema = buildFacilitiesSchema(facilitiesLayerInfo);
    const schema = facilitySchema;
    const routeFields = resolveFields(routesLayerInfo, ROUTE_CANDIDATES);
    const minefieldFields: FieldMap = minefieldsLayerInfo
      ? resolveFields(minefieldsLayerInfo, MINEFIELD_CANDIDATES)
      : {};
    const startFields: FieldMap = startLayerInfo ? resolveFields(startLayerInfo, START_POINT_CANDIDATES) : {};

    const facilities: FacilityRecord[] = facilityFeatures.map((feature, index) => {
      const attributes = feature.attributes;
      const objectIdRaw = attributes[facilitiesLayerInfo.objectIdField];
      const objectId = typeof objectIdRaw === 'number' ? objectIdRaw : Number(objectIdRaw);
      const globalId = readText(attributes, facilitiesLayerInfo.globalIdField);
      const display = (field: FacilityField | null): string => {
        if (!field) return '';
        const value = attributes[field.name];
        return field.kind === 'coded' ? displayFieldValue(field, value) : value == null ? '' : String(value);
      };
      const visitField = fieldByName(schema, schema.core.lastVisitDate);

      return {
        id: globalId || (Number.isFinite(objectId) ? String(objectId) : `facility-${index}`),
        objectId: Number.isFinite(objectId) ? objectId : undefined,
        name: display(fieldByName(schema, schema.core.name)) || 'Назва не вказана',
        type: display(fieldByName(schema, schema.core.type)),
        address: display(fieldByName(schema, schema.core.address)),
        departments:
          display(fieldByName(schema, schema.core.departments)) || capabilitySummary(schema, attributes),
        lastVisitDate: visitField
          ? (toInputValue(visitField, attributes[visitField.name]) as string)
          : '',
        visitedBy: display(fieldByName(schema, schema.core.visitedBy)),
        location: pointFromGeometry(feature.geometry),
        attributes,
      };
    });

    const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));

    const routes: RouteRecord[] = routeFeatures.map((feature, index) => {
      const attributes = feature.attributes;
      const facilityGuid = readText(attributes, routeFields.facilityGuid);
      const facility = facilityById.get(facilityGuid);
      return {
        id: readText(attributes, routesLayerInfo.globalIdField) || `route-${index}`,
        code: readText(attributes, routeFields.taskCode),
        taskId: readText(attributes, routeFields.taskId),
        facilityId: facilityGuid,
        facilityName: facility?.name ?? 'Заклад не визначено',
        routeType: mapRouteType(readValue(attributes, routeFields.routeType)),
        isCurrent: mapIsCurrent(readValue(attributes, routeFields.isCurrent)),
        surveyedBy: readText(attributes, routeFields.surveyedBy),
        surveyDate: toIsoDate(readValue(attributes, routeFields.surveyDate)),
        geometry: lineFromGeometry(feature.geometry),
      };
    });

    routes.sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
      return (right.surveyDate ?? '').localeCompare(left.surveyDate ?? '');
    });

    const minefields: MinefieldRecord[] = minefieldFeatures.map((feature, index) => ({
      id: readText(feature.attributes, minefieldsLayerInfo?.globalIdField ?? null) || `minefield-${index}`,
      taskId: readText(feature.attributes, minefieldFields.taskId),
      taskCode: readText(feature.attributes, minefieldFields.taskCode),
      name: readText(feature.attributes, minefieldFields.name),
      location: pointFromGeometry(feature.geometry),
    }));

    const startPoints: StartPointRecord[] = [];
    startFeatures.forEach((feature: Feature, index) => {
      const location = pointFromGeometry(feature.geometry);
      if (!location) return;
      startPoints.push({
        id: readText(feature.attributes, startLayerInfo?.globalIdField ?? null) || `start-${index}`,
        parentGlobalId: readText(feature.attributes, startFields.parentGuid ?? null),
        location,
      });
    });

    const visitedField = fieldByName(schema, schema.core.visitedBy);
    const visitedDefinition = visitedField
      ? facilitiesLayerInfo.fields.find((field) => field.name === visitedField.name)
      : null;

    const medics = unique([
      ...domainValues(routesLayerInfo, routeFields.surveyedBy),
      ...(visitedDefinition?.domain?.codedValues ?? []).map((value) => value.name),
      ...routes.map((route) => route.surveyedBy),
      ...facilities.map((facility) => facility.visitedBy),
    ]);

    if (!routeFields.routeType) {
      notices.push('Шар маршрутів: не знайдено поле типу маршруту — усі маршрути показано як основні.');
    }
    if (!routeFields.isCurrent) {
      notices.push('Шар маршрутів: не знайдено поле актуальності — усі маршрути показано як актуальні.');
    }
    if (!schema.core.lastVisitDate) {
      notices.push('Шар закладів: не знайдено поле дати останнього візиту.');
    }
    if (!schema.core.visitedBy) {
      notices.push('Шар закладів: не знайдено поле «хто відвідав».');
    }
    if (!schema.core.name) {
      notices.push('Шар закладів: не знайдено поле назви закладу.');
    }
    if (!routeFields.facilityGuid) {
      notices.push('Шар маршрутів: не знайдено поле зв’язку із закладом (med_facility_guid).');
    }
    if (schema.fields.length === 0) {
      notices.push('Шар закладів: не знайдено редагованих атрибутивних полів.');
    }
    if (!facilitiesLayerInfo.fields.some((field) => field.type === 'esriFieldTypeGlobalID')) {
      notices.push(
        'Шар закладів: не знайдено поля globalid — перевірка зв’язків із маршрутами може бути неповною.',
      );
    }
    if (!schema.capabilities.create || !schema.capabilities.update || !schema.capabilities.delete) {
      notices.push(
        'Шар закладів: сервіс дозволяє не всі операції редагування. Доступні дії обмежено можливостями шару.',
      );
    }
    if (startPoints.length === 0) {
      notices.push('Шар початкових точок порожній або недоступний для читання.');
    }
    if (!minefieldsLayerInfo) {
      notices.push('Шар мінних полів недоступний для читання — список мінних полів порожній.');
    } else if (minefields.length === 0) {
      notices.push('Шар мінних полів не містить об’єктів.');
    }

    snapshot = { routes, facilities, minefields, startPoints, medics, facilitySchema: schema, notices };
    return snapshot;
  };

  const createFacility = async (draft: FacilityDraft): Promise<FacilityRecord> => {
    const schema = requireSchema();
    if (!schema.capabilities.create) throw new Error('Створення закладів заборонено налаштуваннями шару.');
    assertValid(schema, draft.attributes, true, draft.location);

    const attributes = buildAttributePayload(schema, draft.attributes);
    const result = await applyEdits(appConfig.services.facilities.url, {
      adds: [{ attributes, geometry: draft.location ? pointGeometry(draft.location) : null }],
      token: authToken,
    });
    const added = result.addResults?.[0];
    if (!added || added.success === false) {
      throw new Error(added?.error?.description ?? 'Сервіс не підтвердив створення закладу');
    }
    return recordFromValues(schema, attributes, draft.location, added.objectId, added.globalId);
  };

  const updateFacility = async (
    record: FacilityRecord,
    draft: FacilityDraft,
  ): Promise<FacilityRecord> => {
    const schema = requireSchema();
    if (!schema.capabilities.update) throw new Error('Редагування закладів заборонено налаштуваннями шару.');
    if (record.objectId === undefined) {
      throw new Error('Не знайдено OBJECTID закладу — оновлення неможливе.');
    }
    assertValid(schema, draft.attributes, false, draft.location);

    const attributes = buildAttributePayload(schema, draft.attributes, record);
    const result = await applyEdits(appConfig.services.facilities.url, {
      updates: [
        {
          attributes,
          ...(draft.location ? { geometry: pointGeometry(draft.location) } : {}),
        },
      ],
      token: authToken,
    });
    const updated = result.updateResults?.[0];
    if (!updated || updated.success === false) {
      throw new Error(updated?.error?.description ?? 'Сервіс не підтвердив збереження закладу');
    }
    return recordFromValues(
      schema,
      { ...record.attributes, ...attributes },
      draft.location ?? record.location,
      record.objectId,
      record.id,
    );
  };

  const deleteFacility = async (record: FacilityRecord): Promise<void> => {
    const schema = requireSchema();
    if (!schema.capabilities.delete) throw new Error('Видалення закладів заборонено налаштуваннями шару.');

    const linked = snapshot?.routes.filter((route) => route.facilityId === record.id) ?? [];
    if (linked.length > 0) {
      const codes = linked.map((route) => route.code || route.id).join(', ');
      throw new Error(
        `Заклад пов’язаний із маршрутами (${codes}). Спершу перенесіть або деактивуйте ці маршрути.`,
      );
    }
    if (record.objectId === undefined) {
      throw new Error('Не знайдено OBJECTID закладу — видалення неможливе.');
    }
    await applyEdits(appConfig.services.facilities.url, {
      deletes: [record.objectId],
      token: authToken,
    });
  };

  const initialCapabilities = {
    create: appConfig.services.facilities.editable,
    update: appConfig.services.facilities.editable,
    delete: appConfig.services.facilities.editable,
  };

  return {
    kind: 'arcgis',
    label: 'Portal',
    capabilities: {
      createFacility: initialCapabilities.create,
      editFacility: initialCapabilities.update,
      deleteFacility: initialCapabilities.delete,
      createRoute: false,
      editRouteGeometry: false,
      writeStartPoints: false,
    },
    load,
    createFacility,
    updateFacility,
    deleteFacility,
  };
}
