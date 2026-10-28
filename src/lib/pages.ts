import type { PageId } from '../types';

export interface PageMeta {
  label: string;
  shortLabel: string;
  description: string;
}

export const pageMeta: Record<PageId, PageMeta> = {
  routes: {
    label: 'Маршрути CASEVAC ділянок розмінування',
    shortLabel: 'Маршрути CASEVAC ділянок розмінування',
    description: 'Керуйте маршрутами евакуації та пов’язаними медичними закладами.',
  },
  facilities: {
    label: 'Медичні заклади',
    shortLabel: 'Заклади',
    description: 'Актуальна інформація про лікарні та їхні можливості.',
  },
  'area-plan': {
    label: 'План реагування на область',
    shortLabel: 'План реагування на область',
    description: 'Стан і склад планів реагування за областями.',
  },
  'eod-plan': {
    label: 'Маршрути CASEVAC CDS',
    shortLabel: 'Маршрути CASEVAC CDS',
    description: 'Плани CASEVAC для завдань EOD та їхні шаблони.',
  },
};
