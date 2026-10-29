import type { DataSnapshot, FacilityRecord, MinefieldRecord, RouteRecord, StartPointRecord } from '../types';
import { isActiveValue } from '../lib/facilitySchema';
import { demoFacilityAttributes, demoFacilitySchema } from './demoFacilitySchema';

/**
 * Демонстраційні дані для роботи без Portal (режим VITE_AUTH_MODE=demo).
 * Координати умовні та не є даними реальних об'єктів.
 */

interface FacilitySeed {
  id: string;
  name: string;
  type: string;
  address: string;
  departments: string;
  lastVisitDate: string;
  visitedBy: string;
  location: [number, number];
  extra?: Record<string, unknown>;
}

const facilitySeeds: FacilitySeed[] = [
  {
    id: 'f1',
    name: 'Київська обласна клінічна лікарня',
    type: 'Обласна лікарня',
    address: 'м. Київ, вул. Багговутівська, 1',
    departments: 'Травматологія, хірургія, реанімація',
    lastVisitDate: '2026-10-18',
    visitedBy: 'Олена Коваль',
    location: [30.4869, 50.4588],
    extra: {
      settlement: 'Київ',
      phone: '+380 44 483 11 11',
      email: 'info@kokl.kyiv.ua',
      beds: 620,
      has_icu: 'Так',
      equipment: 'КТ, МРТ, ангіограф, рентген, УЗД',
      has_ct: 'Так',
      has_mri: 'Так',
      operations: 'Невідкладна хірургія, нейрохірургія, судинна хірургія',
      surgery_24_7: 'Так',
      doctors: 'Хірурги, анестезіологи, нейрохірурги, травматологи',
      staff_count: 1450,
      notes: 'Обласний травмацентр, приймає поранених цілодобово.',
    },
  },
  {
    id: 'f2',
    name: 'Бучанська міська лікарня',
    type: 'Міська лікарня',
    address: 'м. Буча, вул. Польова, 21',
    departments: 'Хірургія, інтенсивна терапія',
    lastVisitDate: '2026-10-12',
    visitedBy: 'Іван Петренко',
    location: [30.2187, 50.5432],
    extra: {
      settlement: 'Буча',
      phone: '+380 45 97 4 21 40',
      beds: 180,
      has_icu: 'Так',
      equipment: 'Рентген, УЗД, лабораторія',
      operations: 'Загальна хірургія, невідкладна допомога',
      doctors: 'Хірурги, терапевти, анестезіологи',
      staff_count: 320,
    },
  },
  {
    id: 'f3',
    name: 'Ірпінська центральна міська лікарня',
    type: 'Міська лікарня',
    address: 'м. Ірпінь, вул. Садова, 38',
    departments: 'Травматологія, хірургія',
    lastVisitDate: '2026-10-09',
    visitedBy: 'Олена Коваль',
    location: [30.2506, 50.5218],
    extra: {
      settlement: 'Ірпінь',
      phone: '+380 45 97 6 12 03',
      beds: 240,
      equipment: 'Рентген, УЗД, КТ',
      has_ct: 'Так',
      operations: 'Травматологія, загальна хірургія',
      doctors: 'Травматологи, хірурги',
      staff_count: 410,
    },
  },
  {
    id: 'f4',
    name: 'Вишгородська центральна районна лікарня',
    type: 'Районна лікарня',
    address: 'м. Вишгород, вул. Кургузова, 1',
    departments: 'Хірургія, приймальне відділення',
    lastVisitDate: '2026-06-14',
    visitedBy: 'Максим Бойко',
    location: [30.4497, 50.5844],
    extra: {
      settlement: 'Вишгород',
      phone: '+380 45 96 5 15 80',
      beds: 150,
      equipment: 'Рентген, УЗД',
      operations: 'Загальна хірургія',
      doctors: 'Хірурги, терапевти',
      staff_count: 260,
      is_active: 'Ні',
      notes: 'Потрібне оновлення даних про можливості закладу.',
    },
  },
  {
    id: 'f5',
    name: 'Броварська багатопрофільна клінічна лікарня',
    type: 'Міська лікарня',
    address: 'м. Бровари, вул. Шевченка, 14',
    departments: 'Хірургія, нейрохірургія, реанімація',
    lastVisitDate: '2026-09-30',
    visitedBy: 'Наталія Гриценко',
    location: [30.7909, 50.511],
    extra: {
      settlement: 'Бровари',
      phone: '+380 45 94 5 12 45',
      beds: 380,
      has_icu: 'Так',
      equipment: 'КТ, МРТ, рентген, УЗД, ангіограф',
      has_ct: 'Так',
      has_mri: 'Так',
      operations: 'Нейрохірургія, судинна хірургія, загальна хірургія',
      surgery_24_7: 'Так',
      doctors: 'Нейрохірурги, судинні хірурги, анестезіологи',
      staff_count: 690,
    },
  },
  {
    id: 'f6',
    name: 'Фастівська центральна районна лікарня',
    type: 'Районна лікарня',
    address: 'м. Фастів, вул. Соборна, 12',
    departments: 'Хірургія, терапія',
    lastVisitDate: '2025-12-05',
    visitedBy: 'Іван Петренко',
    location: [29.9178, 50.0746],
    extra: {
      settlement: 'Фастів',
      phone: '+380 45 65 6 11 20',
      beds: 120,
      equipment: 'Рентген, УЗД, лабораторія',
      operations: 'Загальна хірургія',
      doctors: 'Хірурги, терапевти',
      staff_count: 210,
      is_active: 'Ні',
    },
  },
];

const facilities: FacilityRecord[] = facilitySeeds.map((seed) => ({
  id: seed.id,
  name: seed.name,
  type: seed.type,
  address: seed.address,
  departments: seed.departments,
  lastVisitDate: seed.lastVisitDate,
  visitedBy: seed.visitedBy,
  isActive: isActiveValue(seed.extra?.is_active ?? 'Так'),
  location: seed.location,
  attributes: demoFacilityAttributes({
    name: seed.name,
    type: seed.type,
    address: seed.address,
    departments: seed.departments,
    lastVisitDate: seed.lastVisitDate,
    visitedBy: seed.visitedBy,
    extra: seed.extra,
  }),
}));

const minefields: MinefieldRecord[] = [
  {
    id: 'mf-418',
    taskId: '418',
    taskCode: 'UA-32-00418',
    name: 'Ділянка біля Ірпеня',
    location: [30.2914, 50.4021],
  },
  {
    id: 'mf-391',
    taskId: '391',
    taskCode: 'UA-32-00391',
    name: 'Ділянка біля Гостомеля',
    location: [30.3305, 50.4327],
  },
  {
    id: 'mf-364',
    taskId: '364',
    taskCode: 'UA-32-00364',
    name: 'Ділянка біля Вишгорода',
    location: [30.4221, 50.5512],
  },
  {
    id: 'mf-ch-134',
    taskId: '134',
    taskCode: 'HT_CH_134',
    name: 'Ділянка біля Грабівки',
    location: [31.1142, 51.4288],
  },
];

function facility(id: string): FacilityRecord {
  const found = facilities.find((item) => item.id === id);
  if (!found) throw new Error(`Demo facility ${id} not found`);
  return found;
}

function route(
  id: string,
  code: string,
  taskId: string,
  facilityId: string,
  isCurrent: boolean,
  surveyedBy: string,
  surveyDate: string,
  createdAt: string,
  length: number,
  start: [number, number],
): RouteRecord {
  const target = facility(facilityId);
  const end = target.location ?? start;
  return {
    id,
    code,
    taskId,
    facilityId,
    facilityName: target.name,
    isCurrent,
    surveyedBy,
    surveyDate,
    createdAt,
    length,
    geometry: [start, end],
  };
}

const routes: RouteRecord[] = [
  route('r-104', 'UA-32-00418', '418', 'f1', true, 'Олена Коваль', '2026-10-18', '2026-10-29', 12.5, [30.2914, 50.4021]),
  route('r-103', 'UA-32-00418', '418', 'f2', true, 'Іван Петренко', '2026-10-12', '2026-10-28', 12.5, [30.2914, 50.4021]),
  route('r-098', 'UA-32-00391', '391', 'f3', true, 'Олена Коваль', '2026-10-09', '2026-10-27', 8.3, [30.3305, 50.4327]),
  route('r-087', 'UA-32-00364', '364', 'f4', false, 'Максим Бойко', '2026-09-22', '2026-09-22', 15.7, [30.4221, 50.5512]),
  route('r-095', 'UA-32-00391', '391', 'f5', true, 'Наталія Гриценко', '2026-10-02', '2026-10-02', 8.3, [30.3305, 50.4327]),
  route('r-076', 'UA-32-00364', '364', 'f3', false, 'Іван Петренко', '2026-08-14', '2026-08-14', 15.7, [30.4221, 50.5512]),
];

const startPoints: StartPointRecord[] = routes.map((item) => ({
  id: `sp-${item.id}`,
  parentGlobalId: item.id,
  location: item.geometry[0],
}));

export const demoSnapshot: DataSnapshot = {
  routes,
  facilities,
  minefields,
  startPoints,
  medics: ['Олена Коваль', 'Іван Петренко', 'Максим Бойко', 'Наталія Гриценко'],
  facilitySchema: demoFacilitySchema,
  notices: ['Демонстраційні дані: зміни зберігаються лише в пам’яті сторінки.'],
};
