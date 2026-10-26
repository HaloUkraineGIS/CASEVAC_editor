import { Activity, Building2, CircleHelp, Globe2, LogIn, LogOut, Map, ShieldAlert, X } from 'lucide-react';
import type { PageId } from '../types';
import { useAuth } from '../auth/AuthContext';
import { useData } from '../data/DataContext';
import { useToast } from './ToastContext';
import { initials } from '../lib/format';
import { pageMeta } from '../lib/pages';

interface SidebarProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  open: boolean;
  onClose: () => void;
  counts: {
    routes: number;
    facilities: number;
    areaPlans: number;
    eodPlans: number;
  };
}

interface NavItem {
  page: PageId;
  icon: typeof Map;
  count?: number;
}

function formatCount(count: number): string {
  return count.toString().padStart(2, '0');
}

export function Sidebar({ page, onNavigate, open, onClose, counts }: SidebarProps) {
  const { mode, status, user, openPrompt, signOut } = useAuth();
  const { source, status: dataStatus } = useData();
  const { notify } = useToast();

  const workspaceNav: NavItem[] = [
    { page: 'routes', icon: Map, count: counts.routes },
    { page: 'facilities', icon: Building2, count: counts.facilities },
  ];
  const planNav: NavItem[] = [
    { page: 'area-plan', icon: Globe2, count: counts.areaPlans },
    { page: 'eod-plan', icon: ShieldAlert, count: counts.eodPlans },
  ];

  const syncState = (() => {
    if (dataStatus === 'error')
      return { tone: 'red', title: 'Помилка даних', note: 'Не вдалося прочитати шари' };
    if (dataStatus === 'locked')
      return { tone: 'amber', title: 'Потрібен вхід', note: 'Дані недоступні без Portal' };
    if (dataStatus === 'loading') return { tone: 'amber', title: 'Завантаження', note: 'Читаємо дані…' };
    if (source?.kind === 'arcgis')
      return { tone: 'green', title: 'Portal', note: 'Дані з ArcGIS Enterprise' };
    return { tone: 'green', title: 'Демо-дані', note: 'Локально, без Portal' };
  })();

  const profile = (() => {
    if (mode === 'demo') {
      return {
        title: 'Демо-режим',
        note: 'Вхід через Portal не використовується',
        avatar: 'ДМ',
        action: () => notify('Увімкніть VITE_AUTH_MODE=portal, щоб працювати з Portal.', 'info'),
        actionLabel: 'Докладніше про вхід',
        actionIcon: LogIn,
      };
    }
    if (status === 'signedIn' && user) {
      return {
        title: user.fullName,
        note: user.role === 'org_admin' ? 'Адміністратор організації' : 'Медичний відділ',
        avatar: initials(user.fullName),
        action: signOut,
        actionLabel: 'Вийти',
        actionIcon: LogOut,
      };
    }
    if (status === 'signingIn') {
      return {
        title: 'Очікуємо вхід…',
        note: 'Зачекайте завершення входу',
        avatar: '…',
        action: () => undefined,
        actionLabel: 'Вхід виконується',
        actionIcon: LogIn,
      };
    }
    return {
      title: 'Вхід не виконано',
      note: 'Потрібен акаунт ArcGIS Portal',
      avatar: '—',
      action: openPrompt,
      actionLabel: 'Увійти через Portal',
      actionIcon: LogIn,
    };
  })();

  const handleNavigate = (next: PageId) => {
    onNavigate(next);
    onClose();
  };

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand-lockup">
        <div className="brand-mark">
          <Activity size={22} />
        </div>
        <div>
          <strong>CASEVAC</strong>
          <span>MEDICAL PLANNER</span>
        </div>
        <button className="icon-button sidebar-close" onClick={onClose} aria-label="Закрити">
          <X size={18} />
        </button>
      </div>

      <nav className="primary-nav" aria-label="Основна навігація">
        <span className="nav-caption">РОБОЧА ОБЛАСТЬ</span>
        {workspaceNav.map((item) => (
          <button
            key={item.page}
            className={`nav-link ${page === item.page ? 'active' : ''}`}
            onClick={() => handleNavigate(item.page)}
            aria-current={page === item.page ? 'page' : undefined}
          >
            <item.icon size={18} />
            <span>{pageMeta[item.page].label}</span>
            <span className="nav-count">{formatCount(item.count ?? 0)}</span>
          </button>
        ))}

        <span className="nav-caption nav-caption-lower">ПЛАНИ РЕАГУВАННЯ</span>
        {planNav.map((item) => (
          <button
            key={item.page}
            className={`nav-link ${page === item.page ? 'active' : ''}`}
            onClick={() => handleNavigate(item.page)}
            aria-current={page === item.page ? 'page' : undefined}
          >
            <item.icon size={18} />
            <span>{pageMeta[item.page].shortLabel}</span>
            <span className="nav-count">{formatCount(item.count ?? 0)}</span>
          </button>
        ))}

        <span className="nav-caption nav-caption-lower">ДОВІДКА</span>
        <button
          className="nav-link muted-link"
          onClick={() => notify('Документацію буде додано пізніше.', 'info')}
        >
          <CircleHelp size={18} />
          <span>Довідка</span>
        </button>
      </nav>

      <div className="sidebar-bottom">
        <div className="sync-status">
          <span className={`status-dot status-dot-${syncState.tone}`} />
          <div>
            <strong>{syncState.title}</strong>
            <span>{syncState.note}</span>
          </div>
        </div>
        <div className="user-profile">
          <div className="avatar">{profile.avatar}</div>
          <div className="user-copy">
            <strong title={profile.title}>{profile.title}</strong>
            <span>{profile.note}</span>
          </div>
          <button
            className="icon-button"
            onClick={profile.action}
            aria-label={profile.actionLabel}
            title={profile.actionLabel}
          >
            <profile.actionIcon size={17} />
          </button>
        </div>
      </div>
    </aside>
  );
}
