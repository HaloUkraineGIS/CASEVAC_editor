import { buildFacilitySchema, type FacilitySchemaFieldInput } from '../lib/facilitySchema';
import type { FacilitySchema } from '../types';

/**
 * Демонстраційна схема картки закладу.
 *
 * Повторює структуру, яку застосунок очікує від реального шару:
 * загальні дані, відділення, обладнання, операції, лікарі та візит.
 * У режимі Portal ця схема повністю замінюється метаданими шару.
 */

export const DEMO_FACILITY_TYPES = [
  'Обласна лікарня',
  'Міська лікарня',
  'Районна лікарня',
  'Військовий медичний заклад',
  'Інше',
];

const coded = (values: string[]) => ({
  type: 'codedValue' as const,
  codedValues: values.map((value) => ({ name: value, code: value })),
});

const YES_NO = coded(['Так', 'Ні']);

const FIELDS: FacilitySchemaFieldInput[] = [
  {
    name: 'name',
    alias: 'Назва закладу',
    type: 'esriFieldTypeString',
    nullable: false,
    length: 250,
  },
  {
    name: 'facility_type',
    alias: 'Тип закладу',
    type: 'esriFieldTypeString',
    nullable: false,
    domain: coded(DEMO_FACILITY_TYPES),
  },
  { name: 'address', alias: 'Адреса', type: 'esriFieldTypeString', length: 300 },
  { name: 'settlement', alias: 'Населений пункт', type: 'esriFieldTypeString', length: 150 },
  { name: 'phone', alias: 'Телефон', type: 'esriFieldTypeString', length: 80 },
  { name: 'email', alias: 'Електронна пошта', type: 'esriFieldTypeString', length: 120 },
  {
    name: 'ownership',
    alias: 'Форма власності',
    type: 'esriFieldTypeString',
    domain: coded(['Комунальна', 'Державна', 'Приватна']),
  },
  { name: 'beds', alias: 'Кількість ліжок', type: 'esriFieldTypeInteger' },
  {
    name: 'departments',
    alias: 'Відділення',
    type: 'esriFieldTypeString',
    length: 1000,
  },
  {
    name: 'has_emergency',
    alias: 'Приймальне відділення',
    type: 'esriFieldTypeString',
    domain: YES_NO,
  },
  {
    name: 'has_icu',
    alias: 'Реанімація та інтенсивна терапія',
    type: 'esriFieldTypeString',
    domain: YES_NO,
  },
  { name: 'equipment', alias: 'Обладнання', type: 'esriFieldTypeString', length: 1000 },
  {
    name: 'has_ct',
    alias: 'Комп’ютерна томографія (КТ)',
    type: 'esriFieldTypeString',
    domain: YES_NO,
  },
  { name: 'has_mri', alias: 'Магнітно-резонансна томографія (МРТ)', type: 'esriFieldTypeString', domain: YES_NO },
  { name: 'has_xray', alias: 'Рентгенівський апарат', type: 'esriFieldTypeString', domain: YES_NO },
  { name: 'operations', alias: 'Операції', type: 'esriFieldTypeString', length: 1000 },
  {
    name: 'surgery_24_7',
    alias: 'Хірургія 24/7',
    type: 'esriFieldTypeString',
    domain: YES_NO,
  },
  { name: 'doctors', alias: 'Лікарі', type: 'esriFieldTypeString', length: 1000 },
  { name: 'staff_count', alias: 'Кількість медичного персоналу', type: 'esriFieldTypeInteger' },
  { name: 'notes', alias: 'Примітки', type: 'esriFieldTypeString', length: 2000 },
  {
    name: 'last_visit_date',
    alias: 'Дата останнього візиту',
    type: 'esriFieldTypeDate',
    nullable: false,
  },
  {
    name: 'visited_by',
    alias: 'Хто відвідав',
    type: 'esriFieldTypeString',
    nullable: false,
    length: 150,
  },
];

export const demoFacilitySchema: FacilitySchema = buildFacilitySchema({
  source: 'demo',
  title: 'Medical facilities (демо)',
  geometryType: 'esriGeometryPoint',
  objectIdField: 'OBJECTID',
  globalIdField: 'globalid',
  fields: FIELDS,
  capabilities: { create: true, update: true, delete: true },
});

interface DemoAttributeBase {
  name: string;
  type: string;
  address: string;
  departments: string;
  lastVisitDate: string;
  visitedBy: string;
  extra?: Record<string, unknown>;
}

/** Заповнює повний набір атрибутів демонстраційного закладу. */
export function demoFacilityAttributes(base: DemoAttributeBase): Record<string, unknown> {
  return {
    name: base.name,
    facility_type: base.type,
    address: base.address,
    settlement: '',
    phone: '',
    email: '',
    ownership: 'Комунальна',
    beds: '',
    departments: base.departments,
    has_emergency: 'Так',
    has_icu: 'Ні',
    equipment: '',
    has_ct: 'Ні',
    has_mri: 'Ні',
    has_xray: 'Так',
    operations: '',
    surgery_24_7: 'Ні',
    doctors: '',
    staff_count: '',
    notes: '',
    last_visit_date: base.lastVisitDate,
    visited_by: base.visitedBy,
    ...base.extra,
  };
}
