/**
 * Дані для сторінок планів реагування.
 *
 * Це проміжна модель: остаточна структура документів визначається Додатками Б і В
 * до ТЗ. Поки що сторінки показують демонстраційний стан підготовки планів.
 */

export type PlanStatus = 'actual' | 'draft' | 'outdated';

export interface PlanSection {
  id: string;
  title: string;
  note: string;
  ready: boolean;
}

export interface PlanDocument {
  id: string;
  name: string;
  kind: 'plan' | 'map';
  note: string;
  updatedAt: string;
}

export interface AreaPlan {
  id: string;
  region: string;
  code: string;
  facilitiesCount: number;
  routesCount: number;
  updatedAt: string;
  status: PlanStatus;
  coverage: number;
  sections: PlanSection[];
  documents: PlanDocument[];
}

const defaultSections = (readyRoutes: boolean, readyContacts: boolean): PlanSection[] => [
  {
    id: 'title',
    title: 'Титульна частина та затвердження',
    note: 'Шаблон NTS_EORE',
    ready: true,
  },
  {
    id: 'facilities',
    title: 'Перелік медичних закладів області',
    note: 'Дані шару Medical facilities',
    ready: true,
  },
  {
    id: 'map',
    title: 'Карта медичних закладів',
    note: 'Експорт A3, 300 dpi',
    ready: true,
  },
  {
    id: 'routes',
    title: 'Маршрути CASEVAC до закладів',
    note: readyRoutes ? 'Усі маршрути актуальні' : 'Є неактуальні маршрути',
    ready: readyRoutes,
  },
  {
    id: 'contacts',
    title: 'Контакти та порядок оповіщення',
    note: readyContacts ? 'Заповнено' : 'Потрібні дані замовника',
    ready: readyContacts,
  },
  {
    id: 'annexes',
    title: 'Додатки: точки збору та координати',
    note: 'Формується з шару Start evac point',
    ready: false,
  },
];

export const areaPlans: AreaPlan[] = [
  {
    id: 'chernihivska',
    region: 'Чернігівська область',
    code: 'CH',
    facilitiesCount: 24,
    routesCount: 31,
    updatedAt: '2026-10-12',
    status: 'actual',
    coverage: 92,
    sections: defaultSections(true, true),
    documents: [
      {
        id: 'ch-plan',
        name: 'План реагування на Чернігівську область',
        kind: 'plan',
        note: 'Основний документ · DOCX',
        updatedAt: '2026-10-12',
      },
      {
        id: 'ch-map',
        name: 'Карта медичних закладів Чернігівської області',
        kind: 'map',
        note: 'Додаток · A3, 300 dpi',
        updatedAt: '2026-10-12',
      },
    ],
  },
  {
    id: 'kyivska',
    region: 'Київська область',
    code: 'KY',
    facilitiesCount: 18,
    routesCount: 27,
    updatedAt: '2026-10-18',
    status: 'actual',
    coverage: 88,
    sections: defaultSections(true, false),
    documents: [
      {
        id: 'ky-plan',
        name: 'План реагування на Київську область',
        kind: 'plan',
        note: 'Основний документ · DOCX',
        updatedAt: '2026-10-18',
      },
      {
        id: 'ky-map',
        name: 'Карта медичних закладів Київської області',
        kind: 'map',
        note: 'Додаток · A3, 300 dpi',
        updatedAt: '2026-10-18',
      },
    ],
  },
  {
    id: 'sumska',
    region: 'Сумська область',
    code: 'SU',
    facilitiesCount: 12,
    routesCount: 16,
    updatedAt: '2026-09-08',
    status: 'draft',
    coverage: 64,
    sections: defaultSections(false, false),
    documents: [
      {
        id: 'su-plan',
        name: 'План реагування на Сумську область',
        kind: 'plan',
        note: 'Чернетка · потребує перевірки',
        updatedAt: '2026-09-08',
      },
    ],
  },
  {
    id: 'kharkivska',
    region: 'Харківська область',
    code: 'KH',
    facilitiesCount: 21,
    routesCount: 29,
    updatedAt: '2026-08-21',
    status: 'outdated',
    coverage: 71,
    sections: defaultSections(false, true),
    documents: [
      {
        id: 'kh-plan',
        name: 'План реагування на Харківську область',
        kind: 'plan',
        note: 'Потрібне оновлення даних',
        updatedAt: '2026-08-21',
      },
      {
        id: 'kh-map',
        name: 'Карта медичних закладів Харківської області',
        kind: 'map',
        note: 'Додаток · A3, 300 dpi',
        updatedAt: '2026-08-21',
      },
    ],
  },
  {
    id: 'khersonska',
    region: 'Херсонська область',
    code: 'KS',
    facilitiesCount: 9,
    routesCount: 11,
    updatedAt: '2026-07-30',
    status: 'draft',
    coverage: 48,
    sections: defaultSections(false, false),
    documents: [],
  },
];

export interface EodPlan {
  id: string;
  taskCode: string;
  region: string;
  site: string;
  facilityName: string;
  routeCode: string;
  status: PlanStatus;
  updatedAt: string;
  template: string;
  note: string;
}

export const eodPlans: EodPlan[] = [
  {
    id: 'eod-1',
    taskCode: 'HT_KY_188',
    region: 'Київська область',
    site: 'Рудня-Сидорівська',
    facilityName: 'Ірпінська центральна міська лікарня',
    routeCode: 'KY-188/1',
    status: 'actual',
    updatedAt: '2026-10-18',
    template: 'Casevac_Taranyvka.pdf',
    note: 'План сформовано за еталоном EOD',
  },
  {
    id: 'eod-2',
    taskCode: 'HT_CH_134',
    region: 'Чернігівська область',
    site: 'Грабівка',
    facilityName: 'Чернігівська обласна лікарня',
    routeCode: 'CH-134/1',
    status: 'actual',
    updatedAt: '2026-10-06',
    template: 'Casevac_Dymer.pdf',
    note: 'Маршрут обстежено, документ готовий до друку',
  },
  {
    id: 'eod-3',
    taskCode: 'HT_KY_201',
    region: 'Київська область',
    site: 'Тарасівка',
    facilityName: 'Броварська багатопрофільна клінічна лікарня',
    routeCode: 'KY-201/2',
    status: 'draft',
    updatedAt: '2026-09-28',
    template: 'Casevac_Taranyvka.pdf',
    note: 'Чернетка: не заповнено surveyed_by',
  },
  {
    id: 'eod-4',
    taskCode: 'HT_KY_204',
    region: 'Київська область',
    site: 'Димер',
    facilityName: 'Вишгородська центральна районна лікарня',
    routeCode: 'KY-204/1',
    status: 'outdated',
    updatedAt: '2026-07-11',
    template: 'Casevac_Dymer.pdf',
    note: 'Потрібне повторне обстеження маршруту',
  },
];

export function planStatusLabel(status: PlanStatus): string {
  if (status === 'actual') return 'Актуальний';
  if (status === 'draft') return 'Чернетка';
  return 'Потрібне оновлення';
}
