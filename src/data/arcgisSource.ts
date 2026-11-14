import { appConfig } from '../config/appConfig';
import {
  buildFacilitySchema,
  capabilitySummary,
  displayFieldValue,
  facilityIsActive,
  facilityRecordFromValues,
  fieldByName,
  isFieldEmpty,
  toInputValue,
  validateFacilityValues,
} from '../lib/facilitySchema';
import { polylineLengthKm, todayIso } from '../lib/format';
import type {
  DataSnapshot,
  DataSource,
  FacilityDraft,
  FacilityField,
  FacilityRecord,
  FacilitySchema,
  LonLat,
  MinefieldRecord,
  RouteDraft,
  RouteRecord,
  StartPointRecord,
} from '../types';
import {
  applyEdits,
  describeLayer,
  queryAllFeatures,
  type Feature,
  type LayerField,
  type LayerInfo,
  type PointGeometry,
  type PolylineGeometry,
} from './arcgisRest';

type FieldMap = Record<string, string | null>;

const ROUTE_CANDIDATES: Record<string, string[]> = {
  taskId: ['task_id', 'taskid'],
  taskCode: ['task_code', 'taskcode'],
  taskName: ['task_name', 'taskname', 'task_name_ukr', 'tasknameukr'],
  facilityGuid: ['med_facility_guid', 'med_facility_globalid', 'facility_guid'],
  isCurrent: ['is_current', 'iscurrent', 'actual', 'is_active'],
  /** Тип завдання ділянки (поле task_type шару маршрутів). */
  taskType: ['task_type', 'tasktype'],
  /** Ознака перевірки даних маршруту. */
  dataChecked: ['data_checked', 'datachecked'],
  surveyedBy: ['surveyed_by', 'surveyedby', 'surveyed', 'created_by_medic'],
  surveyDate: ['survey_date', 'surveydate', 'last_edited_date', 'created_date'],
  createdAt: ['created_date', 'creation_date', 'creationdate'],
  length: ['length', 'lenth', 'route_length', 'routelength'],
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

function lineGeometry(points: LonLat[]): PolylineGeometry {
  return {
    type: 'polyline',
    paths: [points.map(([lon, lat]) => [lon, lat])],
    spatialReference: { wkid: 4326 },
  };
}

/** Значення домену, яке позначає актуальний маршрут. */
const CURRENT_DOMAIN_VALUE = /^(так|yes|true|1|actual|current|актуальн)/i;

/** Значення домену, яке позначає неактуальний маршрут. */
const INACTIVE_DOMAIN_VALUE = /^(ні|no|false|0|inactive|неактуальн)/i;

/** Значення домену, яке позначає ствердну відповідь (для data_checked). */
const AFFIRMATIVE_DOMAIN_VALUE = /^(так|yes|true|1)/i;

/**
 * Текстове значення атрибута ділянки: регістронезалежний пошук за кількома
 * варіантами назви поля. Назви полів у сервісі ділянок можуть відрізнятися
 * регістром, тому точний збіг не гарантований.
 */
function minefieldText(attributes: Record<string, unknown>, ...names: string[]): string {
  const lowered = new Map(
    Object.entries(attributes).map(([key, value]) => [key.toLowerCase(), value]),
  );
  for (const name of names) {
    const value = lowered.get(name.toLowerCase());
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

/**
 * Приводить значення до типу поля шару: коди домену, дата в мілісекундах,
 * числа та рядки. Для кодованих полів без збігу повертає вихідне значення —
 * виклик, що створює запис, окремо перевіряє такі випадки.
 */
function fieldValue(field: LayerField | undefined, value: unknown, preferDomain?: RegExp): unknown {
  if (!field) return value;

  const codedValues = field.domain?.type === 'codedValue' ? (field.domain.codedValues ?? []) : [];
  if (codedValues.length > 0) {
    const needle = String(value).trim().toLowerCase();
    const direct = codedValues.find((option) => String(option.name).trim().toLowerCase() === needle);
    if (direct) return direct.code;
    if (preferDomain) {
      const preferred = codedValues.find(
        (option) => preferDomain.test(String(option.name)) || preferDomain.test(String(option.code)),
      );
      if (preferred) return preferred.code;
    }
    return value;
  }

  if (field.type === 'esriFieldTypeDate') {
    const raw = String(value);
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  if (
    field.type === 'esriFieldTypeInteger' ||
    field.type === 'esriFieldTypeSmallInteger' ||
    field.type === 'esriFieldTypeOID'
  ) {
    return Math.round(Number(value));
  }
  if (field.type === 'esriFieldTypeDouble' || field.type === 'esriFieldTypeSingle') {
    return Number(value);
  }
  return String(value).trim();
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
  let routesLayer: LayerInfo | null = null;

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
    routesLayer = routesLayerInfo;
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
        lastVisitDate: visitField ? (toInputValue(visitField, attributes[visitField.name]) as string) : '',
        visitedBy: display(fieldByName(schema, schema.core.visitedBy)),
        isActive: facilityIsActive(schema, attributes),
        location: pointFromGeometry(feature.geometry),
        attributes,
      };
    });

    const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));

    const routes: RouteRecord[] = routeFeatures.map((feature, index) => {
      const attributes = feature.attributes;
      const objectIdRaw = attributes[routesLayerInfo.objectIdField];
      const objectId = typeof objectIdRaw === 'number' ? objectIdRaw : Number(objectIdRaw);
      const facilityGuid = readText(attributes, routeFields.facilityGuid);
      const facility = facilityById.get(facilityGuid);
      return {
        id: readText(attributes, routesLayerInfo.globalIdField) || `route-${index}`,
        objectId: Number.isFinite(objectId) ? objectId : undefined,
        code: readText(attributes, routeFields.taskCode),
        taskId: readText(attributes, routeFields.taskId),
        taskName: readText(attributes, routeFields.taskName),
        facilityId: facilityGuid,
        facilityName: facility?.name ?? 'Заклад не визначено',
        isCurrent: mapIsCurrent(readValue(attributes, routeFields.isCurrent)),
        surveyedBy: readText(attributes, routeFields.surveyedBy),
        surveyDate: toIsoDate(readValue(attributes, routeFields.surveyDate)),
        createdAt: toIsoDate(readValue(attributes, routeFields.createdAt)),
        length: readValue(attributes, routeFields.length) as number | undefined,
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
      attributes: feature.attributes,
    }));

    // Якщо в шарі маршрутів немає поля task_name, беремо назву з мінного поля.
    const minefieldNameByTaskId = new Map(minefields.map((minefield) => [minefield.taskId, minefield.name]));
    routes.forEach((route) => {
      if (!route.taskName) route.taskName = minefieldNameByTaskId.get(route.taskId) ?? '';
    });

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

  const updateFacility = async (record: FacilityRecord, draft: FacilityDraft): Promise<FacilityRecord> => {
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

  /**
   * Готує атрибути та геометрію для створення/оновлення маршруту.
   * Значення приводяться до типів полів і доменів шару.
   */
  const buildRouteWrite = (
    draft: RouteDraft,
    isCurrent: boolean,
    withCreatedAt: boolean,
  ): {
    attributes: Record<string, unknown>;
    geometry: LonLat[];
    lengthKm: number;
    surveyDate: string;
    objectIdField: string;
  } => {
    const layer = routesLayer;
    if (!layer) throw new Error('Шар маршрутів ще не завантажено. Оновіть дані.');

    const geometry = draft.geometry.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
    if (geometry.length < 2) {
      throw new Error('Намалюйте лінію маршруту: потрібно щонайменше дві точки.');
    }

    const fields = resolveFields(layer, ROUTE_CANDIDATES);
    const definition = (key: string): LayerField | undefined => {
      const name = fields[key];
      return name ? layer.fields.find((field) => field.name === name) : undefined;
    };
    const attributes: Record<string, unknown> = {};
    const put = (key: string, value: unknown, preferDomain?: RegExp): void => {
      const name = fields[key];
      if (!name || value === undefined || value === null || value === '') return;
      attributes[name] = fieldValue(definition(key), value, preferDomain);
    };

    // Для кодованого довідника медиків значення має бути саме з домену.
    const surveyedField = definition('surveyedBy');
    const surveyedOptions =
      surveyedField?.domain?.type === 'codedValue' ? (surveyedField.domain.codedValues ?? []) : [];
    if (
      surveyedOptions.length > 0 &&
      !surveyedOptions.some(
        (option) => String(option.name).trim().toLowerCase() === draft.surveyedBy.trim().toLowerCase(),
      )
    ) {
      throw new Error('Обраний медик відсутній у довіднику шару маршрутів. Оберіть іншого.');
    }

    const lengthKm = Math.round(polylineLengthKm(geometry) * 100) / 100;
    const surveyDate = draft.surveyDate || todayIso();

    put('taskId', draft.taskId);
    put('taskCode', draft.code);
    put('facilityGuid', draft.facilityId);
    put('isCurrent', isCurrent, isCurrent ? CURRENT_DOMAIN_VALUE : INACTIVE_DOMAIN_VALUE);
    put('surveyedBy', draft.surveyedBy);
    put('surveyDate', surveyDate);
    if (withCreatedAt) put('createdAt', todayIso());
    put('length', lengthKm);

    // Додаткові поля з шару ділянок розмінування: тип і назва завдання
    // копіюються з атрибутів ділянки, до якої прив'язаний маршрут.
    // Порожні значення не пишуться, щоб не затирати наявні дані.
    const minefield = snapshot?.minefields.find((item) => item.taskId === draft.taskId);
    const minefieldAttributes = minefield?.attributes ?? {};
    put(
      'taskName',
      minefieldText(minefieldAttributes, 'task_name', 'task_name_ukr', 'taskname') ||
        minefield?.name,
    );
    put('taskType', minefieldText(minefieldAttributes, 'task_type', 'tasktype'));
    // Збереження маршруту означає перевірку даних — ставимо 'yes'
    // (для кодованого домену підбереться відповідний код).
    put('dataChecked', 'yes', AFFIRMATIVE_DOMAIN_VALUE);

    return { attributes, geometry, lengthKm, surveyDate, objectIdField: layer.objectIdField };
  };

  const createRoute = async (draft: RouteDraft): Promise<RouteRecord> => {
    if (!appConfig.services.routes.editable) {
      throw new Error('Створення маршрутів заборонено налаштуваннями сервісу.');
    }

    const { attributes, geometry, lengthKm, surveyDate } = buildRouteWrite(draft, true, true);

    const result = await applyEdits(appConfig.services.routes.url, {
      adds: [{ attributes, geometry: lineGeometry(geometry) }],
      token: authToken,
    });
    const added = result.addResults?.[0];
    if (!added || added.success === false) {
      throw new Error(added?.error?.description ?? 'Сервіс не підтвердив створення маршруту');
    }

    const facility = snapshot?.facilities.find((item) => item.id === draft.facilityId);
    const taskName = snapshot?.minefields.find((item) => item.taskId === draft.taskId)?.name ?? '';
    return {
      id: added.globalId || (added.objectId !== undefined ? String(added.objectId) : `route-${Date.now()}`),
      objectId: added.objectId,
      code: draft.code,
      taskId: draft.taskId,
      taskName,
      facilityId: draft.facilityId,
      facilityName: facility?.name ?? '',
      isCurrent: true,
      surveyedBy: draft.surveyedBy,
      surveyDate,
      createdAt: todayIso(),
      length: lengthKm,
      geometry,
    };
  };

  const updateRoute = async (record: RouteRecord, draft: RouteDraft): Promise<RouteRecord> => {
    if (!appConfig.services.routes.editable) {
      throw new Error('Редагування маршрутів заборонено налаштуваннями сервісу.');
    }
    if (record.objectId === undefined) {
      throw new Error('Не знайдено OBJECTID маршруту — оновлення неможливе.');
    }

    const { attributes, geometry, lengthKm, surveyDate, objectIdField } = buildRouteWrite(
      draft,
      record.isCurrent,
      false,
    );
    attributes[objectIdField] = record.objectId;

    const result = await applyEdits(appConfig.services.routes.url, {
      updates: [{ attributes, geometry: lineGeometry(geometry) }],
      token: authToken,
    });
    const updated = result.updateResults?.[0];
    if (!updated || updated.success === false) {
      throw new Error(updated?.error?.description ?? 'Сервіс не підтвердив збереження маршруту');
    }

    const facility = snapshot?.facilities.find((item) => item.id === draft.facilityId);
    const taskName =
      snapshot?.minefields.find((item) => item.taskId === draft.taskId)?.name ?? record.taskName;
    return {
      ...record,
      code: draft.code,
      taskId: draft.taskId,
      taskName,
      facilityId: draft.facilityId,
      facilityName: facility?.name ?? record.facilityName,
      surveyedBy: draft.surveyedBy,
      surveyDate,
      length: lengthKm,
      geometry,
    };
  };

  const deleteRoute = async (record: RouteRecord): Promise<void> => {
    if (!appConfig.services.routes.editable) {
      throw new Error('Видалення маршрутів заборонено налаштуваннями сервісу.');
    }
    if (record.objectId === undefined) {
      throw new Error('Не знайдено OBJECTID маршруту — видалення неможливе.');
    }

    const result = await applyEdits(appConfig.services.routes.url, {
      deletes: [record.objectId],
      token: authToken,
    });
    const deleted = result.deleteResults?.[0];
    if (!deleted || deleted.success === false) {
      throw new Error(deleted?.error?.description ?? 'Сервіс не підтвердив видалення маршруту');
    }
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
      createRoute: appConfig.services.routes.editable,
      editRoute: appConfig.services.routes.editable,
      deleteRoute: appConfig.services.routes.editable,
      writeStartPoints: false,
    },
    load,
    createFacility,
    updateFacility,
    deleteFacility,
    createRoute,
    updateRoute,
    deleteRoute,
  };
}
