import { todayIso } from './format';
import type {
  FacilityField,
  FacilityFieldKind,
  FacilityFieldOption,
  FacilityRecord,
  FacilitySchema,
  FacilitySection,
  LonLat,
} from '../types';

/**
 * Побудова схеми картки закладу з метаданих ArcGIS-шару.
 *
 * Назви полів у сервісі заздалегідь невідомі (Додаток А відсутній), тому:
 * - усі редаговані поля шару потрапляють у форму автоматично;
 * - ключові поля (назва, тип, адреса тощо) визначаються за назвою/alias;
 * - розділи FR-9 формуються за ключовими словами в назві та alias.
 */

export interface FacilitySchemaFieldInput {
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
    codedValues?: { name: string; code: string | number }[];
    range?: [number, number];
  } | null;
}

export interface BuildFacilitySchemaInput {
  source: 'demo' | 'arcgis';
  title: string;
  geometryType?: string;
  objectIdField?: string;
  globalIdField?: string;
  fields: FacilitySchemaFieldInput[];
  capabilities: { create: boolean; update: boolean; delete: boolean };
}

type CoreKey = keyof FacilitySchema['core'];

const CORE_CANDIDATES: Record<CoreKey, string[]> = {
  name: ['name_ukr', 'name', 'facility_name', 'title', 'назва', 'найменування'],
  type: ['facility_type', 'type', 'classification', 'тип', 'категорія'],
  address: ['address', 'location_address', 'адреса', 'місцезнаходження'],
  departments: ['departments', 'department', 'відділення', 'відділи'],
  lastVisitDate: [
    'last_visit_date',
    'lastvisitdate',
    'status_date',
    'visit_date',
    'дата_останнього_візиту',
    'дата візиту',
  ],
  visitedBy: ['visited_by', 'visitedby', 'created_by_medic', 'хто_відвідав', 'виконавець'],
};

const CORE_FALLBACKS: Record<CoreKey, RegExp> = {
  name: /(^|[_\s])(name|title)($|[_\s])|назв|найменуван/i,
  type: /(^|[_\s])type($|[_\s])|тип|категор/i,
  address: /address|адрес|місцезнаходж/i,
  departments: /department|відділ/i,
  lastVisitDate: /last[_ ]?visit|visit.*date|дата.*візит|status[_ ]?date|дата.*статус/i,
  visitedBy: /visited|хто.*відвід|ким.*відвід|виконав|created_by_medic/i,
};

/**
 * Українські підписи для відомих полів реального шару.
 * У сервісі частина alias англійська або збігається з назвою поля.
 */
const FIELD_LABELS: Record<string, string> = {
  name_ukr: 'Назва коротка (укр.)',
  full_name_ukr: 'Назва повна (укр.)',
  name_eng: 'Назва коротка (англ.)',
  full_name_eng: 'Назва повна (англ.)',
  region: 'Область',
  address: 'Адреса',
  address_eng: 'Адреса (англ.)',
  phone: 'Телефон',
  contact_ukr: 'Контакти (укр.)',
  contact_eng: 'Контакти (англ.)',
  type_of_hospital: 'Тип закладу',
  x: 'Довгота (X)',
  y: 'Широта (Y)',
  is_active: 'Заклад активний',
  status_date: 'Дата візиту',
  created_by_medic: 'Виконавець',
  surgical: 'Хірургія',
  braine_surgical: 'Нейрохірургія',
  face_injures_surgical: 'Щелепно-лицьова хірургія',
  eye_injures_surgical: 'Офтальмохірургія',
  cardiology: 'Кардіологія',
  neurological: 'Неврологія',
  icu_ccu: 'Реанімація та інтенсивна терапія',
  infection_disease: 'Інфекційні хвороби',
  renal_urology: 'Нефрологія та урологія',
  orthopaedic: 'Ортопедія',
  dental: 'Стоматологія',
  burn: 'Опікова допомога',
  military_medic_group: 'Військова медична група',
  laboratory: 'Лабораторія',
  xray: 'Рентген',
  mri: 'МРТ',
  computer_tomography: 'Комп’ютерна томографія (КТ)',
  ultrasound: 'УЗД',
  blood_products_available: 'Препарати крові',
  generator: 'Генератор',
  oxygen: 'Кисень',
};

const YES_NO: FacilityFieldOption[] = [
  { value: 'yes', label: 'Так' },
  { value: 'no', label: 'Ні' },
];

const YES_NO_POSSIBLE: FacilityFieldOption[] = [
  { value: 'yes', label: 'Так' },
  { value: 'no', label: 'Ні' },
  { value: 'possible', label: 'Можливо' },
];

/**
 * Локальні довідники для полів, у яких у шарі немає домену.
 * Коди відповідають значенням, що реально зберігаються в сервісі.
 */
const LOCAL_DOMAINS: Record<string, FacilityFieldOption[]> = {
  type_of_hospital: [
    { value: 'hospital', label: 'Лікарня' },
    { value: 'clinic', label: 'Клініка' },
    { value: 'outpatient_clinic', label: 'Амбулаторія / поліклініка' },
    { value: 'fap', label: 'ФАП (фельдшерсько-акушерський пункт)' },
    { value: 'other', label: 'Інше' },
  ],
  is_active: YES_NO,
  surgical: YES_NO_POSSIBLE,
  braine_surgical: YES_NO_POSSIBLE,
  face_injures_surgical: YES_NO_POSSIBLE,
  eye_injures_surgical: YES_NO_POSSIBLE,
  cardiology: YES_NO_POSSIBLE,
  neurological: YES_NO_POSSIBLE,
  icu_ccu: YES_NO_POSSIBLE,
  infection_disease: YES_NO_POSSIBLE,
  renal_urology: YES_NO_POSSIBLE,
  orthopaedic: YES_NO_POSSIBLE,
  dental: YES_NO_POSSIBLE,
  burn: YES_NO_POSSIBLE,
  military_medic_group: YES_NO_POSSIBLE,
  laboratory: YES_NO_POSSIBLE,
  xray: YES_NO_POSSIBLE,
  mri: YES_NO_POSSIBLE,
  computer_tomography: YES_NO_POSSIBLE,
  ultrasound: YES_NO_POSSIBLE,
  blood_products_available: YES_NO_POSSIBLE,
  generator: YES_NO_POSSIBLE,
  oxygen: YES_NO_POSSIBLE,
};

/** Поля-X та поля-Y, які дублюють геометрію закладу (WGS84). */
const LON_FIELD_NAMES = ['x', 'lon', 'lng', 'longitude', 'x_coord', 'xcoord', 'довгота'];
const LAT_FIELD_NAMES = ['y', 'lat', 'latitude', 'y_coord', 'ycoord', 'широта'];

/** Поля можливостей закладу (не плутати з полем «Відділення»). */
const CAPABILITY_FIELD_NAMES = new Set(
  Object.keys(LOCAL_DOMAINS).filter((name) => name !== 'type_of_hospital' && name !== 'is_active'),
);

/** Розділи, поля яких описують можливості закладу. */
const CAPABILITY_SECTION_IDS = new Set(['departments', 'paraclinical']);
const CAPABILITY_VALUES = new Set(['yes', 'possible']);

/**
 * Поля реального шару, для яких розділ визначено явно.
 * Це надійніше за пошук за ключовими словами в alias: у сервісі,
 * наприклад, «Офтальмологія» — це хірургічне відділення, а не обладнання.
 */
const FIELD_SECTIONS: Record<string, string> = {
  surgical: 'departments',
  braine_surgical: 'departments',
  face_injures_surgical: 'departments',
  eye_injures_surgical: 'departments',
  cardiology: 'departments',
  neurological: 'departments',
  icu_ccu: 'departments',
  infection_disease: 'departments',
  renal_urology: 'departments',
  orthopaedic: 'departments',
  dental: 'departments',
  burn: 'departments',
  military_medic_group: 'departments',
  laboratory: 'paraclinical',
  xray: 'paraclinical',
  mri: 'paraclinical',
  computer_tomography: 'paraclinical',
  ultrasound: 'paraclinical',
  blood_products_available: 'paraclinical',
  generator: 'paraclinical',
  oxygen: 'paraclinical',
};

interface SectionRule {
  id: string;
  title: string;
  pattern: RegExp;
}

/** Розділи картки в порядку відображення (FR-9). */
const SECTIONS: SectionRule[] = [
  {
    id: 'departments',
    title: 'Відділення',
    pattern:
      /department|відділ|cardio|кардіо|neuro|невро|icu|intensive|реанімац|infection|інфекц|renal|urolog|уролог|orthop|ортопед|dental|стоматолог|burn|опік|trauma|травмат|therapy|терап|military|військов|profile|профіл|emergency|приймальн|operation|surgery|surgical|операц|хірург|ophthalm|офтальм|(^|[^a-z])eye([^a-z]|$)|brain|мозк|face|щелеп|лицьов|doctor|лікар|staff|personnel|персонал|medic|медик|specialist|спеціаліст/i,
  },
  {
    id: 'paraclinical',
    title: 'Параклінічні служби',
    pattern:
      /equip|device|обладна|апарат|rentgen|рентген|xray|x-ray|(^|[^a-z])(ct|kt|mri)([^a-z]|$)|tomograph|томограф|ultrasound|ультразв|узі|узд|lab|лаборатор|blood|кров|ventilat|штучн|generator|генератор|oxygen|кисень|кисн/i,
  },
];

const COORDINATE_FIELD_NAMES = new Set([...LON_FIELD_NAMES, ...LAT_FIELD_NAMES]);

function isCoordinateField(name: string): boolean {
  return COORDINATE_FIELD_NAMES.has(name.toLowerCase());
}

const GEOMETRY_FIELDS = new Set(['shape', 'geometry', 'the_geom']);
const SYSTEM_FIELDS = new Set([
  'objectid',
  'oid',
  'globalid',
  'global_id',
  'shape_length',
  'shape_area',
  'shape__length',
  'shape__area',
  'created_user',
  'created_date',
  'last_edited_user',
  'last_edited_date',
]);
const BLOB_TYPES = /esriFieldType(Geometry|Blob|Raster)/i;

function fieldKind(field: FacilitySchemaFieldInput, alias: string): FacilityFieldKind {
  if (field.type === 'esriFieldTypeDate') return 'date';
  if (field.domain?.type === 'codedValue') return 'coded';
  if (/esriFieldType(Double|Single|Integer|SmallInteger|BigInteger)/i.test(field.type)) {
    return 'number';
  }
  const longText =
    /note|comment|descr|detail|department|equipment|operation|doctor|staff|приміт|опис|відділ|обладна|операц|лікар/i;
  if (field.type === 'esriFieldTypeString' && ((field.length ?? 0) > 500 || longText.test(alias))) {
    return 'longText';
  }
  return 'text';
}

function domainOptions(field: FacilitySchemaFieldInput): FacilityFieldOption[] | undefined {
  if (field.domain?.type !== 'codedValue') return undefined;
  return (field.domain.codedValues ?? [])
    .filter((item) => item && item.name !== undefined)
    .map((item) => ({ value: item.code, label: translateCodedLabel(item.name, item.code) }));
}

const CODED_LABELS: Record<string, string> = {
  yes: 'Так',
  no: 'Ні',
  possible: 'Можливо',
};

/** Перекладає технічні коди доменів (yes/no/possible), не чіпаючи змістовних назв. */
function translateCodedLabel(name: string, code: string | number): string {
  const codeKey = String(code).trim().toLowerCase();
  const translated = CODED_LABELS[codeKey];
  if (!translated) return name;
  const text = String(name).trim();
  if (
    text.toLowerCase() === codeKey ||
    new RegExp(`^${codeKey}(\\s*\\|.*)?$`, 'i').test(text)
  ) {
    return translated;
  }
  return name;
}

function normalizeField(field: FacilitySchemaFieldInput): FacilityField | null {
  const name = field.name?.trim();
  if (!name) return null;
  const key = name.toLowerCase();
  if (SYSTEM_FIELDS.has(key) || GEOMETRY_FIELDS.has(key) || BLOB_TYPES.test(field.type)) return null;

  const alias = FIELD_LABELS[key] ?? (field.alias?.trim() || name);
  const editable = field.editable !== false;
  if (!editable) return null;

  const serviceOptions = domainOptions(field);
  const localOptions = serviceOptions && serviceOptions.length > 0 ? serviceOptions : LOCAL_DOMAINS[key];
  const kind = localOptions && localOptions.length > 0 ? 'coded' : fieldKind(field, alias);
  const range = field.domain?.type === 'range' ? field.domain.range : undefined;
  return {
    name,
    alias,
    kind,
    editable,
    required: field.nullable === false,
    domain:
      localOptions && localOptions.length > 0
        ? { type: 'codedValue', options: localOptions }
        : range
          ? { type: 'range', min: range[0], max: range[1] }
          : undefined,
    length: field.length,
    defaultValue: field.defaultValue,
    description: field.description,
  };
}

function matchCore(fields: FacilitySchemaFieldInput[], key: CoreKey): string | null {
  const candidates = CORE_CANDIDATES[key].map((value) => value.toLowerCase());
  // Аліаси на кшталт «Інфекційне відділення» належать полям можливостей,
  // тому для «Відділення» їх не враховуємо.
  const pool =
    key === 'departments'
      ? fields.filter((field) => !CAPABILITY_FIELD_NAMES.has((field.name ?? '').toLowerCase()))
      : fields;
  const exact = pool.find((field) => {
    const name = field.name?.toLowerCase() ?? '';
    const alias = field.alias?.toLowerCase() ?? '';
    return candidates.includes(name) || candidates.includes(alias);
  });
  if (exact) return exact.name;

  const fuzzy = pool.find((field) => {
    const alias = field.alias?.trim() || field.name;
    return CORE_FALLBACKS[key].test(`${field.name} ${alias}`);
  });
  return fuzzy?.name ?? null;
}

function sectionFor(field: FacilityField, core: FacilitySchema['core']): SectionRule | null {
  // Координати не показуємо у формі: вони розраховуються з точки на карті.
  if (isCoordinateField(field.name)) return null;
  if (field.name === core.lastVisitDate || field.name === core.visitedBy) return null;
  if (field.name === core.name || field.name === core.type || field.name === core.address) return null;

  const override = FIELD_SECTIONS[field.name.toLowerCase()];
  if (override) return SECTIONS.find((section) => section.id === override) ?? null;

  const haystack = `${field.name} ${field.alias}`;
  return SECTIONS.find((section) => section.pattern.test(haystack)) ?? null;
}

function groupFields(fields: FacilityField[], core: FacilitySchema['core']): FacilitySection[] {
  const general: FacilityField[] = [];
  const buckets = new Map<string, FacilityField[]>();

  fields.forEach((field) => {
    if (isCoordinateField(field.name)) return;
    if (field.name === core.lastVisitDate || field.name === core.visitedBy) return;
    const rule = sectionFor(field, core);
    if (!rule) {
      general.push(field);
      return;
    }
    const bucket = buckets.get(rule.id) ?? [];
    bucket.push(field);
    buckets.set(rule.id, bucket);
  });

  const sections: FacilitySection[] = [];
  if (general.length > 0) sections.push({ id: 'general', title: 'Загальне', fields: general });
  SECTIONS.forEach((rule) => {
    const bucket = buckets.get(rule.id);
    if (bucket?.length) sections.push({ id: rule.id, title: rule.title, fields: bucket });
  });

  const visit = fields.filter(
    (field) => field.name === core.lastVisitDate || field.name === core.visitedBy,
  );
  if (visit.length > 0) {
    sections.push({ id: 'visit', title: 'Візит / Оновлення даних', fields: visit });
  }
  return sections;
}

export function buildFacilitySchema(input: BuildFacilitySchemaInput): FacilitySchema {
  const fields = input.fields
    .map(normalizeField)
    .filter((field): field is FacilityField => field !== null);

  const core: FacilitySchema['core'] = {
    name: matchCore(input.fields, 'name'),
    type: matchCore(input.fields, 'type'),
    address: matchCore(input.fields, 'address'),
    departments: matchCore(input.fields, 'departments'),
    lastVisitDate: matchCore(input.fields, 'lastVisitDate'),
    visitedBy: matchCore(input.fields, 'visitedBy'),
  };

  if (!core.name) {
    const fallback = fields.find((field) => field.kind === 'text' || field.kind === 'longText');
    core.name = fallback?.name ?? null;
  }

  // У реальному шарі всі змістовні поля nullable, але картка без назви
  // не має сенсу — вважаємо назву обов'язковою на рівні застосунку (FR-10).
  const nameField = fields.find((field) => field.name === core.name);
  if (nameField) nameField.required = true;

  // FR-11: без дати візиту та виконавця збереження картки не має сенсу,
  // тому обидва поля візиту обов'язкові незалежно від nullable у шарі.
  [core.lastVisitDate, core.visitedBy].forEach((fieldName) => {
    const field = fields.find((item) => item.name === fieldName);
    if (field) field.required = true;
  });

  // Статус активності визначає участь закладу в маршрутах CASEVAC,
  // тому у формі він обов'язковий незалежно від nullable у шарі.
  const activeField = fields.find((field) => isActiveKey(field.name));
  if (activeField) activeField.required = true;

  return {
    source: input.source,
    layerTitle: input.title,
    geometryType: input.geometryType ?? 'esriGeometryPoint',
    objectIdField: input.objectIdField ?? 'OBJECTID',
    globalIdField: input.globalIdField ?? 'globalid',
    fields,
    sections: groupFields(fields, core),
    core,
    capabilities: input.capabilities,
  };
}

export function isFieldEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (typeof value === 'number' && Number.isNaN(value))
  );
}

/** Перетворює сире значення атрибута на значення для форми. */
export function toInputValue(field: FacilityField, value: unknown): string | number {
  if (isFieldEmpty(value)) return '';
  if (field.kind === 'date') {
    if (typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    }
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const dotted = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dotted) {
      const [, day, month, year] = dotted;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
  if (field.kind === 'number') {
    const num = Number(value);
    return Number.isNaN(num) ? '' : num;
  }
  if (field.kind === 'coded') {
    const option = field.domain?.options?.find((item) => String(item.value) === String(value));
    return option ? option.value : String(value);
  }
  return String(value);
}

/** Підпис значення для перегляду: коди доменів замінюються назвами. */
export function displayFieldValue(field: FacilityField, value: unknown): string {
  if (isFieldEmpty(value)) return '';
  if (field.kind === 'coded') {
    const option = field.domain?.options?.find(
      (item) =>
        String(item.value).toLowerCase() === String(value).toLowerCase() ||
        item.label.toLowerCase() === String(value).toLowerCase(),
    );
    return option?.label ?? String(value);
  }
  if (field.kind === 'date') {
    const iso = toInputValue(field, value);
    if (!iso) return '';
    const [year, month, day] = String(iso).split('-');
    return `${day}.${month}.${year}`;
  }
  return String(value);
}

export function fieldByName(schema: FacilitySchema | null, name: string | null): FacilityField | null {
  if (!schema || !name) return null;
  return schema.fields.find((field) => field.name === name) ?? null;
}

/** Поля шару, що дублюють координати геометрії (наприклад, x/y). */
export function coordinateFieldNames(schema: FacilitySchema | null): {
  lon: string | null;
  lat: string | null;
} {
  if (!schema) return { lon: null, lat: null };
  const find = (names: string[]): string | null =>
    schema.fields.find(
      (field) => field.kind === 'number' && names.includes(field.name.toLowerCase()),
    )?.name ?? null;
  return { lon: find(LON_FIELD_NAMES), lat: find(LAT_FIELD_NAMES) };
}

/** Записує координати вибраної точки у поля x/y, якщо вони є в схемі. */
export function applyLocationToValues(
  schema: FacilitySchema | null,
  values: Record<string, string | number>,
  location?: LonLat,
): Record<string, string | number> {
  const { lon, lat } = coordinateFieldNames(schema);
  if (!lon && !lat) return values;
  const next = { ...values };
  if (location) {
    if (lon) next[lon] = Number(location[0].toFixed(7));
    if (lat) next[lat] = Number(location[1].toFixed(7));
  } else {
    if (lon) next[lon] = '';
    if (lat) next[lat] = '';
  }
  return next;
}

/**
 * Короткий перелік можливостей закладу, якщо в шарі немає окремого поля
 * «Відділення»: у реальному сервісі можливості зберігаються стовпцями
 * (хірургія, кардіологія, УЗД тощо). Використовується для рядка списку.
 */
export function capabilitySummary(
  schema: FacilitySchema,
  attributes: Record<string, unknown>,
): string {
  const items: string[] = [];
  schema.sections.forEach((section) => {
    if (!CAPABILITY_SECTION_IDS.has(section.id)) return;
    section.fields.forEach((field) => {
      const value = String(attributes[field.name] ?? '').toLowerCase();
      if (CAPABILITY_VALUES.has(value)) items.push(field.alias);
    });
  });
  if (items.length === 0) return '';
  const head = items.slice(0, 4).join(', ');
  return items.length > 4 ? `${head} +${items.length - 4}` : head;
}

const ACTIVE_TRUE_VALUES = new Set([
  'yes',
  'y',
  'так',
  'є',
  'true',
  '1',
  'active',
  'активний',
]);

/**
 * Чи активний заклад: поле is_active у шарі зберігає yes/no,
 * у демо-даних — «Так»/«Ні», тому приймаємо всі поширені варіанти.
 */
export function isActiveValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const text = String(value ?? '').trim().toLowerCase();
  return ACTIVE_TRUE_VALUES.has(text);
}

/** Назва поля чи атрибута, що означає «заклад активний». */
function isActiveKey(name: string): boolean {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '') === 'isactive';
}

/** Поле статусу активності у схемі — показується окремим блоком форми. */
export function facilityActiveField(schema: FacilitySchema): FacilityField | null {
  return schema.fields.find((item) => isActiveKey(item.name)) ?? null;
}

/**
 * Читає поле is_active з атрибутів незалежно від регістру ключа
 * (Portal може віддати Is_Active / isActive), а якщо поля немає у схемі —
 * шукає відповідний ключ у самих атрибутах.
 */
export function facilityIsActive(
  schema: FacilitySchema,
  attributes: Record<string, unknown>,
): boolean {
  const keys = Object.keys(attributes);
  const fromSchema = schema.fields
    .filter((item) => isActiveKey(item.name))
    .map((item) => item.name)
    .find((name) => keys.includes(name));

  const key =
    fromSchema ??
    keys.find((name) => isActiveKey(name)) ??
    keys.find((name) => name.trim().toLowerCase().replace(/[^a-z0-9]/g, '') === 'active') ??
    null;

  return key ? isActiveValue(attributes[key]) : false;
}

/** Створює картку закладу зі значень форми (спільне для Portal і демо-режиму). */
export function facilityRecordFromValues(
  schema: FacilitySchema,
  values: Record<string, unknown>,
  options: {
    objectId?: number;
    globalId?: string;
    location?: LonLat;
    fallbackId?: string;
  } = {},
): FacilityRecord {
  const attributes: Record<string, unknown> = { ...values };
  if (options.objectId !== undefined) attributes[schema.objectIdField] = options.objectId;

  const nameField = fieldByName(schema, schema.core.name);
  const typeField = fieldByName(schema, schema.core.type);
  const addressField = fieldByName(schema, schema.core.address);
  const departmentsField = fieldByName(schema, schema.core.departments);
  const visitField = fieldByName(schema, schema.core.lastVisitDate);
  const visitedField = fieldByName(schema, schema.core.visitedBy);

  const display = (field: FacilityField | null): string => {
    if (!field) return '';
    const value = attributes[field.name];
    return field.kind === 'coded' ? displayFieldValue(field, value) : value == null ? '' : String(value);
  };

  const visitValue = visitField ? toInputValue(visitField, attributes[visitField.name]) : '';

  return {
    id:
      options.globalId ||
      (options.objectId !== undefined
        ? String(options.objectId)
        : (options.fallbackId ?? `facility-${Date.now()}`)),
    objectId: options.objectId,
    name: display(nameField) || 'Назва не вказана',
    type: display(typeField),
    address: display(addressField),
    departments: display(departmentsField) || capabilitySummary(schema, attributes),
    lastVisitDate: typeof visitValue === 'number' ? String(visitValue) : visitValue,
    visitedBy: display(visitedField),
    isActive: facilityIsActive(schema, attributes),
    location: options.location,
    attributes,
  };
}

/** Початкові значення форми: атрибути запису, значення за замовчуванням, порожнеча. */
export function initialFacilityValues(
  schema: FacilitySchema,
  record?: { attributes: Record<string, unknown> } | null,
): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  schema.fields.forEach((field) => {
    const raw = record?.attributes?.[field.name];
    const source = isFieldEmpty(raw) ? field.defaultValue : raw;
    values[field.name] = toInputValue(field, source);
  });
  // Новий заклад типово активний: у формі це обов'язковий статус,
  // тож підставляємо перше дозволене значення домену (yes / Так).
  if (!record) {
    const activeField = schema.fields.find((field) => isActiveKey(field.name));
    if (activeField && isFieldEmpty(values[activeField.name])) {
      values[activeField.name] = String(activeField.domain?.options?.[0]?.value ?? 'yes');
    }
  }
  return values;
}

/**
 * FR-11: під час збереження картки пропонуємо сьогоднішню дату візиту
 * та поточного користувача (обидва значення можна змінити у формі).
 */
export function applyVisitDefaults(
  schema: FacilitySchema,
  values: Record<string, string | number>,
  date = todayIso(),
  userName = '',
): Record<string, string | number> {
  const next = { ...values };
  if (schema.core.lastVisitDate) next[schema.core.lastVisitDate] = date;

  const visitedField = fieldByName(schema, schema.core.visitedBy);
  if (visitedField) {
    const trimmed = userName.trim();
    const options = visitedField.domain?.options ?? [];
    // У реальному шарі виконавець — поле з доменом медиків. Якщо ПІБ
    // поточного користувача немає серед дозволених значень, залишаємо
    // попереднє значення, щоб не зберегти код поза доменом.
    const allowed =
      trimmed.length > 0 &&
      (options.length === 0 ||
        options.some((option) => String(option.value).trim().toLowerCase() === trimmed.toLowerCase()));
    if (allowed) next[visitedField.name] = trimmed;
  }
  return next;
}

export interface FacilityValidationResult {
  errors: Record<string, string>;
  firstInvalid: string | null;
}

export function validateFacilityValues(
  schema: FacilitySchema,
  values: Record<string, unknown>,
): FacilityValidationResult {
  const errors: Record<string, string> = {};

  schema.fields.forEach((field) => {
    const value = values[field.name];
    if (!field.editable) return;
    if (field.required && isFieldEmpty(value)) {
      errors[field.name] = `Заповніть обов’язкове поле «${field.alias}»`;
      return;
    }
    if (isFieldEmpty(value)) return;

    if (field.kind === 'number') {
      const num = Number(value);
      if (Number.isNaN(num)) {
        errors[field.name] = 'Вкажіть число';
        return;
      }
      const min = field.domain?.min;
      const max = field.domain?.max;
      if (min !== undefined && num < min) errors[field.name] = `Значення не може бути менше ${min}`;
      if (max !== undefined && num > max) errors[field.name] = `Значення не може бути більше ${max}`;
      return;
    }

    if (field.kind === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        errors[field.name] = 'Вкажіть дату у форматі РРРР-ММ-ДД';
      }
      return;
    }

    if (field.kind === 'coded' && field.domain?.options?.length) {
      const known = field.domain.options.some((option) => String(option.value) === String(value));
      if (!known) errors[field.name] = 'Оберіть значення зі списку';
      return;
    }

    if (field.length && String(value).length > field.length) {
      errors[field.name] = `Не більше ${field.length} символів`;
    }
  });

  return { errors, firstInvalid: Object.keys(errors)[0] ?? null };
}
