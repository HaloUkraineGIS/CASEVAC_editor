/** Доменні типи застосунку. Не залежать від ArcGIS API. */

export type PageId = 'routes' | 'facilities' | 'area-plan' | 'eod-plan';

/** [довгота, широта] — порядок, прийнятий в ArcGIS. */
export type LonLat = [number, number];

export interface RouteRecord {
  /** globalid маршруту (у демо-режимі — локальний ідентифікатор). */
  id: string;
  /** task_code мінного поля, до якого прив'язаний маршрут. */
  code: string;
  taskId: string;
  facilityId: string;
  facilityName: string;
  isCurrent: boolean;
  /** ПІБ медика, що обстежив маршрут. */
  surveyedBy: string;
  /** Дата обстеження, ISO (yyyy-mm-dd). */
  surveyDate: string;
  /** Дата створення, ISO (yyyy-mm-dd). */
  createdAt?: string;
  /** Довжина маршруту в кілометрах. */
  length?: number;
  geometry: LonLat[];
}

export interface FacilityRecord {
  /** globalid закладу (у демо-режимі — локальний ідентифікатор). */
  id: string;
  /** OBJECTID для операцій редагування ArcGIS. */
  objectId?: number;
  name: string;
  type: string;
  address: string;
  departments: string;
  /** Дата останнього візиту, ISO (yyyy-mm-dd). Порожній рядок — візиту не було. */
  lastVisitDate: string;
  visitedBy: string;
  /** Заклад активний (поле is_active: yes / так / true / 1). */
  isActive: boolean;
  location?: LonLat;
  /** Повний набір атрибутів шару (у формі редагуються саме вони). */
  attributes: Record<string, unknown>;
}

export interface MinefieldRecord {
  id: string;
  taskId: string;
  taskCode: string;
  name: string;
  location?: LonLat;
  /** Повний набір атрибутів шару (для експорту документу). */
  attributes: Record<string, unknown>;
}

export interface StartPointRecord {
  id: string;
  parentGlobalId: string;
  location: LonLat;
}

export interface FacilityFieldOption {
  /** Значення, яке зберігається в сервісі (код домену). */
  value: string | number;
  /** Підпис для інтерфейсу. */
  label: string;
}

export type FacilityFieldKind = 'text' | 'longText' | 'number' | 'date' | 'coded';

/** Опис одного редагованого поля картки закладу. */
export interface FacilityField {
  name: string;
  alias: string;
  kind: FacilityFieldKind;
  /** Обов'язкове поле (nullable = false у схемі сервісу). */
  required: boolean;
  /** Поле можна редагувати (не OID/globalid/geometry). */
  editable: boolean;
  domain?: {
    type: 'codedValue' | 'range';
    options?: FacilityFieldOption[];
    min?: number;
    max?: number;
  };
  length?: number;
  defaultValue?: unknown;
  description?: string;
}

export interface FacilitySection {
  id: string;
  title: string;
  fields: FacilityField[];
}

/** Схема картки закладу, згенерована з метаданих шару або демо-даних. */
export interface FacilitySchema {
  source: 'demo' | 'arcgis';
  layerTitle: string;
  geometryType: string;
  objectIdField: string;
  globalIdField: string;
  /** Усі поля форми (без службових). */
  fields: FacilityField[];
  /** Поля, згруповані за розділами FR-9. */
  sections: FacilitySection[];
  /** Ключові поля для списку та пошуку. */
  core: {
    name: string | null;
    type: string | null;
    address: string | null;
    departments: string | null;
    lastVisitDate: string | null;
    visitedBy: string | null;
  };
  capabilities: {
    create: boolean;
    update: boolean;
    delete: boolean;
  };
}

export interface DataSnapshot {
  routes: RouteRecord[];
  facilities: FacilityRecord[];
  minefields: MinefieldRecord[];
  startPoints: StartPointRecord[];
  /** Список медиків для полів surveyed_by / visited_by. */
  medics: string[];
  /** Схема картки закладу (поля, домени, обов'язковість). */
  facilitySchema: FacilitySchema | null;
  /** Не критичні попередження під час читання сервісів (наприклад, відсутнє поле). */
  notices: string[];
}

export interface RouteDraft {
  taskId: string;
  code: string;
  facilityId: string;
  surveyedBy: string;
  surveyDate: string;
}

export interface FacilityDraft {
  /** Значення полів за назвою поля шару. */
  attributes: Record<string, unknown>;
  /** Точка закладу в WGS84. */
  location?: LonLat;
}

export type DataSourceKind = 'demo' | 'arcgis';

export interface DataCapabilities {
  createFacility: boolean;
  editFacility: boolean;
  deleteFacility: boolean;
  createRoute: boolean;
  editRouteGeometry: boolean;
  writeStartPoints: boolean;
}

export interface DataSource {
  kind: DataSourceKind;
  /** Підпис для інтерфейсу: «Демо-дані» або «Portal». */
  label: string;
  capabilities: DataCapabilities;
  load: () => Promise<DataSnapshot>;
  createFacility?: (draft: FacilityDraft) => Promise<FacilityRecord>;
  updateFacility?: (record: FacilityRecord, draft: FacilityDraft) => Promise<FacilityRecord>;
  deleteFacility?: (record: FacilityRecord) => Promise<void>;
  createRoute?: (draft: RouteDraft) => Promise<RouteRecord>;
}
