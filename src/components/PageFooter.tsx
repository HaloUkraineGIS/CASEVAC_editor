import { useState, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';
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

/**
 * Повідомлення знімка даних. У звичайному режимі — рядок у потоці сторінки,
 * у плаваючому (`floating`) — вікно поверх інтерфейсу з кнопкою закриття.
 */
export function SnapshotNotices({ floating = false }: { floating?: boolean }) {
  const { snapshot } = useData();
  const [dismissed, setDismissed] = useState<string[]>([]);

  const visible = snapshot.notices.filter((notice) => !dismissed.includes(notice));
  if (visible.length === 0) return null;

  if (!floating) {
    return (
      <div className="data-notice" role="status">
        {visible.map((notice) => (
          <span key={notice}>{notice}</span>
        ))}
      </div>
    );
  }

  return (
    <div className="data-notice data-notice-floating" role="status" aria-live="polite">
      <div className="data-notice-head">
        <Info size={15} />
        <strong>Повідомлення</strong>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрити повідомлення"
          title="Закрити"
          onClick={() => setDismissed(snapshot.notices)}
        >
          <X size={15} />
        </button>
      </div>
      <div className="data-notice-body">
        {visible.map((notice) => (
          <span key={notice}>{notice}</span>
        ))}
      </div>
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
