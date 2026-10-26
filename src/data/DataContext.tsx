import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { createArcGisSource } from './arcgisSource';
import { createDemoSource } from './demoSource';
import type {
  DataSnapshot,
  DataSource,
  FacilityDraft,
  FacilityRecord,
  RouteDraft,
  RouteRecord,
} from '../types';

export type DataStatus = 'loading' | 'ready' | 'error' | 'locked';

const emptySnapshot: DataSnapshot = {
  routes: [],
  facilities: [],
  minefields: [],
  startPoints: [],
  medics: [],
  facilitySchema: null,
  notices: [],
};

interface DataContextValue {
  status: DataStatus;
  error: string | null;
  snapshot: DataSnapshot;
  source: DataSource | null;
  reload: () => Promise<boolean>;
  createFacility: (draft: FacilityDraft) => Promise<FacilityRecord>;
  updateFacility: (record: FacilityRecord, draft: FacilityDraft) => Promise<FacilityRecord>;
  deleteFacility: (record: FacilityRecord) => Promise<void>;
  createRoute: (draft: RouteDraft) => Promise<RouteRecord>;
}

const DataContext = createContext<DataContextValue | null>(null);

/** Перетворює технічне повідомлення на підказку, зрозумілу користувачу. */
function describeLoadError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : 'Не вдалося завантажити дані';
  if (/499|498|token required|invalid token/i.test(message)) {
    return `${message}. Схоже, сесія Portal завершилася — увійдіть повторно.`;
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return `${message}. Перевірте доступ до сервісу (CORS для цього origin і Trusted Servers у Portal).`;
  }
  return message;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { mode, session } = useAuth();

  const source = useMemo<DataSource | null>(() => {
    if (mode === 'demo') return createDemoSource();
    if (mode === 'portal' && session?.token) return createArcGisSource(session.token);
    return null;
  }, [mode, session?.token]);

  const [snapshot, setSnapshot] = useState<DataSnapshot>(emptySnapshot);
  const [status, setStatus] = useState<DataStatus>(source ? 'loading' : 'locked');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<boolean> => {
    if (!source) {
      setSnapshot(emptySnapshot);
      setStatus('locked');
      setError(null);
      return false;
    }
    // Повторне оновлення не повинно приховувати вже завантажений інтерфейс.
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    setError(null);
    try {
      const next = await source.load();
      setSnapshot(next);
      setStatus('ready');
      return true;
    } catch (cause) {
      setError(describeLoadError(cause));
      setStatus('error');
      return false;
    }
  }, [source]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createFacility = useCallback(
    async (draft: FacilityDraft) => {
      if (!source?.createFacility) throw new Error('Створення закладів недоступне в поточному режимі');
      const created = await source.createFacility(draft);
      await reload();
      return created;
    },
    [source, reload],
  );

  const updateFacility = useCallback(
    async (record: FacilityRecord, draft: FacilityDraft) => {
      if (!source?.updateFacility) throw new Error('Редагування закладів недоступне в поточному режимі');
      const updated = await source.updateFacility(record, draft);
      await reload();
      return updated;
    },
    [source, reload],
  );

  const deleteFacility = useCallback(
    async (record: FacilityRecord) => {
      if (!source?.deleteFacility) throw new Error('Видалення закладів недоступне в поточному режимі');
      await source.deleteFacility(record);
      await reload();
    },
    [source, reload],
  );

  const createRoute = useCallback(
    async (draft: RouteDraft) => {
      if (!source?.createRoute) throw new Error('Створення маршрутів недоступне в поточному режимі');
      const created = await source.createRoute(draft);
      await reload();
      return created;
    },
    [source, reload],
  );

  const value = useMemo<DataContextValue>(
    () => ({
      status,
      error,
      snapshot,
      source,
      reload,
      createFacility,
      updateFacility,
      deleteFacility,
      createRoute,
    }),
    [
      status,
      error,
      snapshot,
      source,
      reload,
      createFacility,
      updateFacility,
      deleteFacility,
      createRoute,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
}
