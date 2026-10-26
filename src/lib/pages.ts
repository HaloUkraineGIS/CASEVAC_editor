import type { PageId } from '../types';

export interface PageMeta {
  label: string;
  shortLabel: string;
  description: string;
}

export const pageMeta: Record<PageId, PageMeta> = {
  routes: {
    label: 'Маршрути CASEVAC',
    shortLabel: 'Маршрути',
    description: 'Керуйте маршрутами евакуації та пов’язаними медичними закладами.',
  },
  facilities: {
    label: 'Медичні заклади',
    shortLabel: 'Заклади',
    description: 'Актуальна інформація про лікарні та їхні можливості.',
  },
  'area-plan': {
    label: 'План реагування на область',
    shortLabel: 'План на область',
    description: 'Стан і склад планів реагування за областями.',
  },
  'eod-plan': {
    label: 'План реагування CDS (EOD)',
    shortLabel: 'План CDS (EOD)',
    description: 'Плани CASEVAC для завдань EOD та їхні шаблони.',
  },
};
