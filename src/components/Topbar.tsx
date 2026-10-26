import { Bell, ChevronRight, Menu } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useData } from '../data/DataContext';
import { initials } from '../lib/format';
import { pageMeta } from '../lib/pages';
import type { PageId } from '../types';
import { useToast } from './ToastContext';

interface TopbarProps {
  page: PageId;
  onOpenMenu: () => void;
}

export function Topbar({ page, onOpenMenu }: TopbarProps) {
  const { mode, status, user, openPrompt } = useAuth();
  const { source, status: dataStatus } = useData();
  const { notify } = useToast();

  const connection = (() => {
    if (dataStatus === 'error') return { label: 'Немає зв’язку з даними', tone: 'red' };
    if (dataStatus === 'locked') return { label: 'Потрібен вхід', tone: 'amber' };
    if (dataStatus === 'loading') return { label: 'Завантаження…', tone: 'amber' };
    if (source?.kind === 'arcgis') return { label: 'Portal · онлайн', tone: 'green' };
    return { label: 'Демо-перегляд', tone: 'green' };
  })();

  const avatar = mode === 'demo' ? 'ДМ' : user ? initials(user.fullName) : '—';
  const canSignIn = mode === 'portal' && status !== 'signedIn';

  return (
    <header className="topbar">
      <button className="icon-button mobile-menu-button" onClick={onOpenMenu} aria-label="Меню">
        <Menu size={20} />
      </button>
      <div className="breadcrumbs">
        <span>Медичний відділ</span>
        <ChevronRight size={14} />
        <strong>{pageMeta[page].label}</strong>
      </div>
      <div className="topbar-actions">
        <div
          className="connection-pill"
          title={
            source?.kind === 'arcgis'
              ? 'Дані читаються з ArcGIS Enterprise Portal'
              : 'Демонстраційні дані без Portal'
          }
        >
          <span className={`status-dot status-dot-${connection.tone}`} />
          {connection.label}
        </div>
        <button
          className="icon-button"
          onClick={() => notify('Нових сповіщень немає.', 'info')}
          aria-label="Сповіщення"
        >
          <Bell size={18} />
        </button>
        <div className="topbar-divider" />
        <button
          className="topbar-user"
          onClick={() =>
            canSignIn
              ? openPrompt()
              : notify(
                  mode === 'demo' ? 'Демо-режим: вхід не потрібен.' : 'Ви вже увійшли через Portal.',
                  'info',
                )
          }
          aria-label={canSignIn ? 'Увійти через Portal' : 'Профіль користувача'}
        >
          <div className="avatar avatar-small">{avatar}</div>
        </button>
      </div>
    </header>
  );
}
