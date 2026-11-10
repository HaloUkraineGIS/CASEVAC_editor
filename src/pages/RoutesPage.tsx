import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Hospital,
  Map,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { DataStateGate, PageFooter, SnapshotNotices } from '../components/PageFooter';
import { SearchableSelect } from '../components/SearchableSelect';
import { useToast } from '../components/ToastContext';
import { useData } from '../data/DataContext';
import { useAuth } from '../auth/AuthContext';
import { appConfig } from '../config/appConfig';
import {
  formatCoordinatePair,
  formatDate,
  polylineLengthKm,
  routeColor,
  routeStatusLabel,
} from '../lib/format';
import { exportResponsePlan } from '../lib/docxExport';
import type { RouteDraft, RouteRecord } from '../types';

// Ліниво завантажуємо модальне вікно карти, щоб не тягнути ArcGIS-чанк у головний бандл
const RouteMapExportModal = lazy(() =>
  import('../components/RouteMapExportModal').then((m) => ({ default: m.RouteMapExportModal })),
);

// Планувальник маршруту також тримає окремий ArcGIS-бандл.
const RouteBuilderModal = lazy(() =>
  import('../components/RouteBuilderModal').then((module) => ({
    default: module.RouteBuilderModal,
  })),
);

const RoutesMap = lazy(() =>
  import('../components/RoutesMap').then((module) => ({ default: module.RoutesMap })),
);

type RouteFilter = 'all' | 'current';

const FILTERS: { id: RouteFilter; label: string }[] = [
  { id: 'all', label: 'Усі маршрути' },
  { id: 'current', label: 'Актуальні' },
];

/** Скільки маршрутів показуємо на сторінці; решта — скрол усередині таблиці. */
const PAGE_SIZE = 100;

export function RoutesPage() {
  const { snapshot, source, createRoute, updateRoute, deleteRoute } = useData();
  const { notify } = useToast();
  const { session } = useAuth();

  const { routes, facilities, minefields, startPoints, medics } = snapshot;
  const canCreate = source?.capabilities.createRoute === true;
  const canEdit = source?.capabilities.editRoute === true;
  const canDelete = source?.capabilities.deleteRoute === true;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RouteFilter>('all');
  const [facilityFilter, setFacilityFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<RouteRecord | null>(null);
  const [mapExportOpen, setMapExportOpen] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  // Довідник закладів для фільтра: швидкий пошук + алфавітний порядок.
  const facilityOptions = useMemo(() => {
    const sorted = facilities
      .map((facility) => ({
        value: facility.id,
        label: facility.name,
        keywords: `${facility.type} ${facility.address}`,
      }))
      .sort((left, right) => left.label.localeCompare(right.label, 'uk', { sensitivity: 'base' }));
    return [{ value: 'all', label: 'Усі заклади' }, ...sorted];
  }, [facilities]);

  const filtersActive = query.trim().length > 0 || filter !== 'all' || facilityFilter !== 'all';

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return routes
      .filter((route) => {
        const matchesQuery =
          needle.length === 0 ||
          `${route.code} ${route.taskName} ${route.facilityName} ${route.surveyedBy}`
            .toLowerCase()
            .includes(needle);
        const matchesFacility = facilityFilter === 'all' || route.facilityId === facilityFilter;
        const matchesType = filter === 'all' || (filter === 'current' && route.isCurrent);
        return matchesQuery && matchesFacility && matchesType;
      })
      .sort((a, b) => {
        // Сортування за датою створення (найновіші першими)
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
  }, [routes, query, facilityFilter, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRoutes = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Будь-яка зміна фільтрів повертає таблицю на першу сторінку.
  useEffect(() => {
    setPage(1);
  }, [query, filter, facilityFilter]);

  // Автоматичний перехід на наступну сторінку при скролі до кінця таблиці
  useEffect(() => {
    const tableWrap = tableRef.current;
    if (!tableWrap) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = tableWrap;
      // Якщо доскролили до кінця (з невеликим буфером 10px)
      if (scrollTop + clientHeight >= scrollHeight - 10 && currentPage < pageCount) {
        setPage((prev) => Math.min(prev + 1, pageCount));
      }
    };

    tableWrap.addEventListener('scroll', handleScroll);
    return () => tableWrap.removeEventListener('scroll', handleScroll);
  }, [currentPage, pageCount]);

  // Прокручування таблиці на початок при зміні сторінки
  useEffect(() => {
    if (tableRef.current) {
      tableRef.current.scrollTop = 0;
    }
  }, [currentPage]);

  const activeRoute = filtered.find((route) => route.id === selectedId) ?? filtered[0];
  const activeFacility = facilities.find((facility) => facility.id === activeRoute?.facilityId);
  const activeStart = activeRoute?.geometry[0];
  const activeEnd = activeRoute?.geometry[activeRoute.geometry.length - 1];

  const goToPage = (next: number) => {
    setPage(Math.min(Math.max(next, 1), pageCount));
  };

  const resetFilters = () => {
    setQuery('');
    setFilter('all');
    setFacilityFilter('all');
  };

  const selectRoute = (id: string) => {
    setSelectedId(id);
    const index = filtered.findIndex((route) => route.id === id);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1);
  };

  const openDraft = () => {
    setEditingRoute(null);
    setDraftOpen(true);
  };

  const openEdit = (route: RouteRecord) => {
    if (!canEdit) {
      notify('Редагування маршрутів недоступне в поточному режимі.', 'info');
      return;
    }
    setSelectedId(route.id);
    setEditingRoute(route);
    setDraftOpen(true);
  };

  const closeBuilder = () => {
    setDraftOpen(false);
    setEditingRoute(null);
  };

  const handleCreateRoute = async (draft: RouteDraft) => {
    const created = await createRoute(draft);
    setSelectedId(created.id);
    closeBuilder();
    const length = created.length ?? polylineLengthKm(created.geometry);
    notify(`Маршрут ${created.code} створено (${length.toFixed(1)} км).`, 'success');
    return created;
  };

  const handleUpdateRoute = async (route: RouteRecord, draft: RouteDraft) => {
    const updated = await updateRoute(route, draft);
    setSelectedId(updated.id);
    closeBuilder();
    const length = updated.length ?? polylineLengthKm(updated.geometry);
    notify(`Маршрут ${updated.code} збережено (${length.toFixed(1)} км).`, 'success');
    return updated;
  };

  const handleDeleteRoute = async (route: RouteRecord) => {
    await deleteRoute(route);
    closeBuilder();
    setSelectedId(null);
    notify(`Маршрут ${route.code || route.id} видалено.`, 'success');
  };

  const handleExportPlan = async () => {
    if (!activeRoute) return;

    const minefield = minefields.find((item) => item.taskId === activeRoute.taskId);
    const facility = facilities.find((item) => item.id === activeRoute.facilityId);

    if (!minefield) {
      notify('Не знайдено мінне поле для маршруту', 'error');
      return;
    }

    if (!facility) {
      notify('Не знайдено медичний заклад для маршруту', 'error');
      return;
    }

    try {
      notify('Генерація документу...', 'info');

      // Якщо є templateItemId у Portal-режимі, завантажуємо з Portal
      if (appConfig.authMode === 'portal' && appConfig.templateItemId && session?.token) {
        await exportResponsePlan(activeRoute, minefield, minefield.attributes, facility, {
          portalUrl: appConfig.portalUrl,
          templateItemId: appConfig.templateItemId,
          token: session.token,
        });
      } else {
        // Інакше використовуємо локальний шаблон (враховуємо базовий шлях Vite)
        const basePath = import.meta.env.BASE_URL || '/';
        await exportResponsePlan(activeRoute, minefield, minefield.attributes, facility, {
          templatePath: `${basePath}template/task_accident-response-plan.docx`,
        });
      }

      notify(`План реагування ${activeRoute.code} завантажено`, 'success');
    } catch (error) {
      console.error('Помилка експорту документу:', error);
      notify(error instanceof Error ? error.message : 'Не вдалося згенерувати документ', 'error');
    }
  };

  const headingCanCreateTitle = canCreate
    ? 'Створити маршрут'
    : 'Створення маршрутів недоступне в поточному режимі.';

  const firstShown = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(currentPage * PAGE_SIZE, filtered.length);

  return (
    <div className="page-content routes-page">
      <section className="page-heading page-heading-compact">
        <div>
          <h1 className="h1-compact">Маршрути CASEVAC ділянок розмінування</h1>
          <p>Керуйте маршрутами евакуації та пов’язаними медичними закладами.</p>
        </div>
        <div className="heading-actions">
          <button
            className="button button-primary"
            onClick={openDraft}
            disabled={!canCreate}
            title={headingCanCreateTitle}
          >
            <Plus size={18} />
            Створити маршрут
          </button>
        </div>
      </section>

      <SnapshotNotices floating />

      <DataStateGate>
        <section className="workspace-grid routes-workspace">
          <div className="map-panel panel routes-map-panel">
            <div className="panel-heading">
              <div>
                <div className="section-title">
                  <MapPin size={17} />
                  Карта маршрутів
                </div>
              </div>
            </div>
            <div className="routes-map-stage">
              {mapExpanded && (
                <div
                  className="routes-map-backdrop"
                  onClick={() => setMapExpanded(false)}
                  aria-hidden="true"
                />
              )}
              <Suspense
                fallback={
                  <div className="facility-map-skeleton">
                    <span className="spin" />
                    Завантажуємо карту…
                  </div>
                }
              >
                <RoutesMap
                  routes={filtered}
                  facilities={facilities}
                  minefields={minefields}
                  facilityFilterId={facilityFilter}
                  selectedId={activeRoute?.id ?? null}
                  onSelect={selectRoute}
                  expanded={mapExpanded}
                  onToggleExpand={() => setMapExpanded((expanded) => !expanded)}
                />
              </Suspense>
            </div>
          </div>

          <div className="route-detail-panel panel">
            {activeRoute ? (
              <>
                <div className="panel-heading detail-heading">
                  <div>
                    <div className="section-title">Деталі маршруту</div>
                    <span className="section-subtitle">Вибраний маршрут на карті</span>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Редагувати маршрут"
                    title={canEdit ? 'Редагувати маршрут' : 'Редагування недоступне'}
                    onClick={() => openEdit(activeRoute)}
                    disabled={!canEdit}
                  >
                    <Pencil size={16} />
                  </button>
                </div>
                <div className="route-detail-body">
                  <div className="detail-route-heading">
                    <div className={`route-symbol ${routeColor(activeRoute)}`}>
                      <Map size={18} />
                    </div>
                    <div>
                      <div className="detail-code">{activeRoute.code}</div>
                      <div className="detail-meta">Маршрут CASEVAC</div>
                    </div>
                    <span
                      className={`status-badge ${activeRoute.isCurrent ? 'status-current' : 'status-inactive'}`}
                    >
                      <span />
                      {routeStatusLabel(activeRoute)}
                    </span>
                  </div>
                  <div className="detail-divider" />
                  <div className="detail-field">
                    <span className="detail-label">МЕДИЧНИЙ ЗАКЛАД</span>
                    <div className="facility-detail">
                      <span className="facility-mini-icon">
                        <Hospital size={16} />
                      </span>
                      <div>
                        <strong>{activeRoute.facilityName}</strong>
                        <span>{activeFacility?.type ?? 'Медичний заклад'}</span>
                      </div>
                      <ChevronRight size={16} />
                    </div>
                  </div>
                  <div className="detail-fields-row">
                    <div className="detail-field">
                      <span className="detail-label">ОБСТЕЖИВ МАРШРУТ</span>
                      <strong className="detail-value">{activeRoute.surveyedBy || 'Не вказано'}</strong>
                    </div>
                    <div className="detail-field">
                      <span className="detail-label">ДАТА ОБСТЕЖЕННЯ</span>
                      <strong className="detail-value">
                        <CalendarDays size={14} />
                        {formatDate(activeRoute.surveyDate)}
                      </strong>
                    </div>
                  </div>
                  <div className="detail-field">
                    <span className="detail-label">НАПРЯМОК ЕВАКУАЦІЇ</span>
                    <div className="detail-coordinates">
                      <div>
                        <span>МІННЕ ПОЛЕ · ПОЧАТОК</span>
                        <strong>{activeStart ? formatCoordinatePair(activeStart) : '—'}</strong>
                      </div>
                      <div className="detail-direction">
                        <ArrowRight size={14} />
                        {activeRoute.length !== undefined && activeRoute.length !== null && (
                          <span>{activeRoute.length.toFixed(1)} км</span>
                        )}
                      </div>
                      <div>
                        <span>МЕДЗАКЛАД · КІНЕЦЬ</span>
                        <strong>{activeEnd ? formatCoordinatePair(activeEnd) : '—'}</strong>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Кнопки експорту — поза прокручуваним тілом, щоб не зникали у вузькому вікні. */}
                <div className="route-detail-footer">
                  <div className="export-actions">
                    <button className="export-card" onClick={() => setMapExportOpen(true)}>
                      <span className="export-icon export-map">
                        <Map size={17} />
                      </span>
                      <span>
                        <strong>Створити карту</strong>
                      </span>
                    </button>
                    <button className="export-card" onClick={handleExportPlan}>
                      <span className="export-icon export-doc">
                        <FileText size={17} />
                      </span>
                      <span>
                        <strong>План реагування</strong>
                      </span>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-detail">
                <MapPin size={25} />
                <strong>Маршрути не знайдені</strong>
                <span>Змініть фільтр або створіть маршрут.</span>
              </div>
            )}
          </div>
        </section>

        <section className="routes-list-panel panel">
          <div className="list-toolbar routes-toolbar">
            <div className="routes-toolbar-title">
              <div className="section-title">
                Список маршрутів <span className="list-count">{filtered.length}</span>
              </div>
            </div>
            <div className="list-tools">
              <div className="routes-facility-select">
                <SearchableSelect
                  value={facilityFilter}
                  options={facilityOptions}
                  placeholder="Усі заклади"
                  searchPlaceholder="Пошук закладу"
                  emptyLabel="Закладів не знайдено"
                  ariaLabel="Фільтр за медичним закладом"
                  onChange={setFacilityFilter}
                  popover
                />
              </div>
              <label className="search-field search-field-small">
                <Search size={15} />
                <input
                  placeholder="Пошук маршруту"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button button-quiet routes-reset-filters"
                onClick={resetFilters}
                disabled={!filtersActive}
                title="Скинути всі фільтри"
              >
                <RotateCcw size={14} />
                <span>Скинути фільтри</span>
              </button>
            </div>
            <div className="filter-tabs">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  className={`filter-tab ${filter === item.id ? 'selected' : ''}`}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                  {item.id === 'all' && <span>{routes.length}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="route-table-wrap" ref={tableRef}>
            <table className="route-table">
              <thead>
                <tr>
                  <th>МАРШРУТ</th>
                  <th>TASK NAME</th>
                  <th>МЕДИЧНИЙ ЗАКЛАД</th>
                  <th>СТАТУС</th>
                  <th>ОБСТЕЖЕНО</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageRoutes.map((route) => (
                  <tr
                    key={route.id}
                    className={activeRoute?.id === route.id ? 'row-selected' : ''}
                    onClick={() => setSelectedId(route.id)}
                  >
                    <td>
                      <div className="table-route">
                        <span className={`route-table-icon ${routeColor(route)}`}>
                          <Map size={15} />
                        </span>
                        <div>
                          <strong>{route.code || 'Без коду'}</strong>
                          <span>{route.surveyDate ? formatDate(route.surveyDate) : 'Дата не вказана'}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="table-task-name" title={route.taskName || undefined}>
                        {route.taskName || '—'}
                      </div>
                    </td>
                    <td>
                      <div className="table-facility">
                        <strong>{route.facilityName}</strong>
                        <span>
                          {facilities.find((facility) => facility.id === route.facilityId)?.type ??
                            'Медичний заклад'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`status-badge table-status ${route.isCurrent ? 'status-current' : 'status-inactive'}`}
                      >
                        <span />
                        {routeStatusLabel(route)}
                      </span>
                    </td>
                    <td>
                      <div className="survey-date">
                        {formatDate(route.surveyDate)}
                        <span>{route.surveyedBy || 'Не вказано'}</span>
                      </div>
                    </td>
                    <td>
                      <button
                        className="icon-button row-more"
                        aria-label="Редагувати маршрут"
                        title={canEdit ? 'Редагувати маршрут' : 'Редагування недоступне'}
                        disabled={!canEdit}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(route);
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="no-results">
                <Search size={21} />
                <strong>Нічого не знайдено</strong>
                <span>Змініть пошуковий запит або фільтр.</span>
              </div>
            )}
          </div>
          <div className="table-footer">
            <span>
              Показано{' '}
              <strong>
                {firstShown}–{lastShown}
              </strong>{' '}
              із <strong>{filtered.length}</strong> маршрутів
            </span>
            <div className="pagination">
              <button
                className="icon-button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                aria-label="Попередня сторінка"
              >
                <ChevronLeft size={15} />
              </button>
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
                <button
                  key={number}
                  className={`page-number ${number === currentPage ? 'active-page' : ''}`}
                  onClick={() => goToPage(number)}
                  aria-label={`Сторінка ${number}`}
                >
                  {number}
                </button>
              ))}
              <button
                className="icon-button"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= pageCount}
                aria-label="Наступна сторінка"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </section>

        <PageFooter note="Огляд маршрутів" />

        {mapExportOpen && activeRoute && (
          <Suspense fallback={null}>
            <RouteMapExportModal
              route={activeRoute}
              facility={activeFacility}
              minefield={minefields.find((item) => item.taskId === activeRoute.taskId)}
              onClose={() => setMapExportOpen(false)}
            />
          </Suspense>
        )}

        {draftOpen && (
          <Suspense fallback={null}>
            <RouteBuilderModal
              minefields={minefields}
              facilities={facilities}
              medics={medics}
              startPoints={startPoints}
              route={editingRoute ?? undefined}
              onClose={closeBuilder}
              onCreate={handleCreateRoute}
              onUpdate={canEdit ? handleUpdateRoute : undefined}
              onDelete={canDelete ? handleDeleteRoute : undefined}
            />
          </Suspense>
        )}
      </DataStateGate>
    </div>
  );
}
