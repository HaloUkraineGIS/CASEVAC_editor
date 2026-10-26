/**
 * Мінімальний клієнт ArcGIS REST для читання та редагування даних
 * у feature/map services. Не залежить від @arcgis/core.
 */

export class ArcGisRestError extends Error {
  readonly code: number | string;
  readonly details: string[];

  constructor(message: string, code: number | string = 'unknown', details: string[] = []) {
    super(message);
    this.name = 'ArcGisRestError';
    this.code = code;
    this.details = details;
  }
}

export interface CodedValue {
  name: string;
  code: string | number;
}

export interface LayerField {
  name: string;
  alias: string;
  type: string;
  nullable?: boolean;
  editable?: boolean;
  length?: number;
  defaultValue?: unknown;
  description?: string;
  domain?: {
    type: 'codedValue' | 'range';
    codedValues?: CodedValue[];
    range?: [number, number];
  } | null;
}

export interface LayerInfo {
  id: number;
  name: string;
  description: string;
  geometryType: string;
  objectIdField: string;
  globalIdField: string;
  maxRecordCount: number;
  capabilities: string;
  supportsAdvancedQueries: boolean;
  fields: LayerField[];
}

export interface Feature {
  attributes: Record<string, unknown>;
  geometry: Record<string, unknown> | null;
}

export interface PointGeometry {
  x: number;
  y: number;
  spatialReference: { wkid: number };
}

export interface FeatureEdit {
  attributes: Record<string, unknown>;
  geometry?: PointGeometry | null;
}

export interface EditResult {
  objectId?: number;
  globalId?: string;
  success?: boolean;
  error?: {
    code?: number;
    description?: string;
  };
}

export interface ApplyEditsResult {
  addResults?: EditResult[];
  updateResults?: EditResult[];
  deleteResults?: EditResult[];
}

interface RawErrorPayload {
  error?: {
    code?: number | string;
    message?: string;
    details?: string[];
  };
}

interface RawRangeDomain {
  type?: string;
  range?: [number, number];
  codedValues?: CodedValue[];
}

interface RawLayerInfo extends RawErrorPayload {
  id?: number;
  name?: string;
  description?: string;
  geometryType?: string;
  objectIdField?: string;
  globalIdField?: string;
  maxRecordCount?: number;
  capabilities?: string;
  supportsAdvancedQueries?: boolean;
  fields?: (Omit<LayerField, 'domain'> & { domain?: RawRangeDomain | null })[];
}

interface RawQueryResponse extends RawErrorPayload {
  features?: Feature[];
  exceededTransferLimit?: boolean;
}

function throwIfError(payload: RawErrorPayload, context: string): void {
  if (payload.error) {
    throw new ArcGisRestError(
      `${context}: ${payload.error.message ?? 'невідома помилка сервісу'}`,
      payload.error.code ?? 'unknown',
      payload.error.details ?? [],
    );
  }
}

async function getJson<T extends RawErrorPayload>(
  url: string,
  params: Record<string, string>,
  context: string,
): Promise<T> {
  const requestUrl = new URL(url);
  Object.entries({ f: 'json', ...params }).forEach(([key, value]) => {
    requestUrl.searchParams.set(key, value);
  });

  const response = await fetch(requestUrl.toString());
  if (!response.ok) {
    throw new ArcGisRestError(`${context}: HTTP ${response.status}`, response.status);
  }

  const payload = (await response.json()) as T;
  throwIfError(payload, context);
  return payload;
}

async function postForm<T extends RawErrorPayload>(
  url: string,
  params: Record<string, string>,
  context: string,
): Promise<T> {
  const body = new URLSearchParams({ f: 'json', ...params });
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new ArcGisRestError(`${context}: HTTP ${response.status}`, response.status);
  }

  const payload = (await response.json()) as T;
  throwIfError(payload, context);
  return payload;
}

function normalizeDomain(domain: RawRangeDomain | null | undefined): LayerField['domain'] {
  if (!domain) return undefined;
  if (domain.type === 'codedValue') {
    return { type: 'codedValue', codedValues: domain.codedValues ?? [] };
  }
  if (domain.type === 'range') {
    return { type: 'range', range: domain.range };
  }
  return undefined;
}

export async function describeLayer(layerUrl: string, token?: string): Promise<LayerInfo> {
  const params: Record<string, string> = {};
  if (token) params.token = token;
  const payload = await getJson<RawLayerInfo>(layerUrl, params, 'Метадані шару');
  const fields = payload.fields ?? [];

  // У частині шарів (наприклад, MapServer, опублікований як Feature Layer)
  // objectIdField / globalIdField не заповнені — визначаємо їх за типами полів.
  const objectIdField =
    payload.objectIdField ??
    fields.find((field) => field.type === 'esriFieldTypeOID')?.name ??
    'OBJECTID';
  const globalIdField =
    payload.globalIdField ??
    fields.find((field) => field.type === 'esriFieldTypeGlobalID')?.name ??
    '';

  return {
    id: payload.id ?? 0,
    name: payload.name ?? '',
    description: payload.description ?? '',
    geometryType: payload.geometryType ?? '',
    objectIdField,
    globalIdField,
    maxRecordCount: payload.maxRecordCount ?? 1000,
    capabilities: payload.capabilities ?? '',
    supportsAdvancedQueries: payload.supportsAdvancedQueries ?? false,
    fields: fields.map((field) => ({
      ...field,
      domain: normalizeDomain(field.domain),
    })),
  };
}

export interface QueryOptions {
  where?: string;
  outFields?: string;
  returnGeometry?: boolean;
  token?: string;
}

/**
 * Читає всі об'єкти шару з посторінковим довантаженням.
 * Геометрія повертається у WGS84 (outSR=4326).
 */
export async function queryAllFeatures(
  layerUrl: string,
  layer: LayerInfo,
  options: QueryOptions = {},
): Promise<Feature[]> {
  const pageSize = Math.min(layer.maxRecordCount, 1000);
  const features: Feature[] = [];
  const maxPages = 50;
  // Деякі шари не мають objectIdField у метаданих — тоді сортування не передаємо.
  const orderField = layer.fields.some((field) => field.name === layer.objectIdField)
    ? layer.objectIdField
    : null;

  for (let page = 0; page < maxPages; page += 1) {
    const params: Record<string, string> = {
      where: options.where ?? '1=1',
      outFields: options.outFields ?? '*',
      returnGeometry: String(options.returnGeometry ?? true),
      outSR: '4326',
      resultOffset: String(page * pageSize),
      resultRecordCount: String(pageSize),
    };
    if (orderField) params.orderByFields = `${orderField} ASC`;
    if (options.token) params.token = options.token;

    const payload = await postForm<RawQueryResponse>(`${layerUrl}/query`, params, 'Запит до шару');
    features.push(...(payload.features ?? []));

    if (!payload.exceededTransferLimit || (payload.features ?? []).length === 0) break;
  }

  return features;
}

export interface ApplyEditsOptions {
  adds?: FeatureEdit[];
  updates?: FeatureEdit[];
  /** OBJECTID записів для видалення. */
  deletes?: number[];
  token?: string;
  /** Якщо true (типово), сервер не застосує жодної зміни, коли хоч одна не вдалася. */
  rollbackOnFailure?: boolean;
}

function collectEditErrors(results: EditResult[] | undefined, action: string): string[] {
  return (results ?? [])
    .filter((result) => result.success === false || result.error)
    .map((result) => {
      const description = result.error?.description ?? 'невідома помилка';
      const code = result.error?.code ? ` (код ${result.error.code})` : '';
      return `${action}: ${description}${code}`;
    });
}

/**
 * Застосовує зміни до шару через applyEdits.
 * Геометрія передається у WGS84 і проєктується сервером.
 */
export async function applyEdits(
  layerUrl: string,
  options: ApplyEditsOptions,
): Promise<ApplyEditsResult> {
  const params: Record<string, string> = {
    rollbackOnFailure: String(options.rollbackOnFailure ?? true),
  };
  if (options.adds?.length) params.adds = JSON.stringify(options.adds);
  if (options.updates?.length) params.updates = JSON.stringify(options.updates);
  if (options.deletes?.length) params.deletes = JSON.stringify(options.deletes);
  if (options.token) params.token = options.token;

  const payload = await postForm<ApplyEditsResult & RawErrorPayload>(
    `${layerUrl}/applyEdits`,
    params,
    'Збереження змін',
  );

  const errors = [
    ...collectEditErrors(payload.addResults, 'Додавання'),
    ...collectEditErrors(payload.updateResults, 'Оновлення'),
    ...collectEditErrors(payload.deleteResults, 'Видалення'),
  ];
  if (errors.length > 0) {
    throw new ArcGisRestError(errors.join('; '), 'edit-failed', errors);
  }
  return payload;
}
