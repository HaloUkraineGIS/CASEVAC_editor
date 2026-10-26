import type { ReactNode } from 'react';
import { appConfig } from '../config/appConfig';
import { useAuth } from '../auth/AuthContext';
import { useData } from '../data/DataContext';

export function PageFooter({ note }: { note: string }) {
  const { source } = useData();
  const context =
    source?.kind === 'arcgis'
      ? 'Дані з ArcGIS Enterprise Portal'
      : 'Демо-режим · синхронізацію з Portal не підключено';

  return (
    <footer className="page-footnote">
      <span>CASEVAC PLANNER</span>
      <span>
        {note} · {context}
      </span>
      <span>v{appConfig.version}</span>
    </footer>
  );
}

export function SnapshotNotices() {
  const { snapshot } = useData();
  if (snapshot.notices.length === 0) return null;
  return (
    <div className="data-notice" role="status">
      {snapshot.notices.map((notice) => (
        <span key={notice}>{notice}</span>
      ))}
    </div>
  );
}

export function DataStateGate({ children }: { children: ReactNode }) {
  const { status, error, reload, source } = useData();
  const { openPrompt } = useAuth();

  if (status === 'locked') {
    return (
      <div className="data-state">
        <strong>Потрібен вхід через Portal</strong>
        <span>Дані медичних закладів і маршрутів доступні лише авторизованим користувачам.</span>
        <button className="button button-primary" onClick={openPrompt}>
          Увійти через Portal
        </button>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="data-state" role="status">
        <strong>Завантажуємо дані…</strong>
        <span>
          {source?.kind === 'arcgis'
            ? 'Читаємо шари ArcGIS від імені користувача.'
            : 'Готуємо демонстраційні дані.'}
        </span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="data-state data-state-error" role="alert">
        <strong>Не вдалося завантажити дані</strong>
        <span>{error ?? 'Невідома помилка'}</span>
        <button className="button button-secondary" onClick={() => void reload()}>
          Повторити
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
