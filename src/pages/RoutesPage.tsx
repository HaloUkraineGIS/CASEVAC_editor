import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Hospital,
  Map,
  MapPin,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { DataStateGate, PageFooter, SnapshotNotices } from '../components/PageFooter';
import { useToast } from '../components/ToastContext';
import { useData } from '../data/DataContext';
import { useAuth } from '../auth/AuthContext';
import { appConfig } from '../config/appConfig';
import {
  formatCoordinatePair,
  formatDate,
  routeColor,
  routeStatusLabel,
  todayIso,
} from '../lib/format';
import { exportResponsePlan } from '../lib/docxExport';

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

interface RouteFormState {
  taskId: string;
  facilityId: string;
  surveyedBy: string;
  surveyDate: string;
}

const emptyForm = (): RouteFormState => ({
  taskId: '',
  facilityId: '',
  surveyedBy: '',
  surveyDate: todayIso(),
});

export function RoutesPage() {
  const { snapshot, source, createRoute } = useData();
  const { notify } = useToast();
  const { session } = useAuth();

  const { routes, facilities, minefields, medics } = snapshot;
  const canCreate = source?.capabilities.createRoute === true;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RouteFilter>('all');
  const [facilityFilter, setFacilityFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [form, setForm] = useState<RouteFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return routes
      .filter((route) => {
        const matchesQuery =
          needle.length === 0 ||
          `${route.code} ${route.facilityName} ${route.surveyedBy}`.toLowerCase().includes(needle);
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

  const selectRoute = (id: string) => {
    setSelectedId(id);
    const index = filtered.findIndex((route) => route.id === id);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1);
  };

  const openDraft = () => {
    setForm(emptyForm());
    setDraftOpen(true);
  };

  const submitDraft = async () => {
    const minefield = minefields.find((item) => item.taskId === form.taskId);
    if (!minefield || !form.facilityId || !form.surveyedBy || !form.surveyDate) {
      notify('Заповніть мінне поле, заклад, медика та дату обстеження.', 'error');
      return;
    }
    setSaving(true);
    try {
      const created = await createRoute({
        taskId: minefield.taskId,
        code: minefield.taskCode,
        facilityId: form.facilityId,
        surveyedBy: form.surveyedBy,
        surveyDate: form.surveyDate,
      });
      setSelectedId(created.id);
      setDraftOpen(false);
      notify('Маршрут додано до чернетки. Геометрія та початкова точка — наступний етап.');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Не вдалося створити маршрут', 'error');
    } finally {
      setSaving(false);
    }
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
      notify(
        error instanceof Error ? error.message : 'Не вдалося згенерувати документ',
        'error',
      );
    }
  };

  const headingCanCreateTitle = canCreate
    ? 'Створити маршрут'
    : 'Створення маршрутів у режимі Portal буде доступне після підключення геометрії (етап 4).';

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
                <span className="section-subtitle">
                  Заклади · маршрути · мінні поля · полігони обстежень · лінія фронту
                </span>
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
                    title="Редагувати маршрут"
                    onClick={() =>
                      notify(
                        'Редагування геометрії потребує підключення Sketch та Feature Service (етап 4).',
                        'info',
                      )
                    }
                  >
                    <SlidersHorizontal size={17} />
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
                      <ArrowRight size={14} />
                      <div>
                        <span>МЕДЗАКЛАД · КІНЕЦЬ</span>
                        <strong>{activeEnd ? formatCoordinatePair(activeEnd) : '—'}</strong>
                      </div>
                    </div>
                    {activeRoute.length !== undefined && activeRoute.length !== null && (
                      <div className="detail-route-length">
                        <span>Довжина маршруту</span>
                        <strong>{activeRoute.length.toFixed(1)} км</strong>
                      </div>
                    )}
                  </div>
                  <div className="detail-divider" />
                  <div className="export-actions">
                    <button
                      className="export-card"
                      onClick={() => notify(`Експорт карти ${activeRoute.code} у JPG — етап 5 плану.`)}
                    >
                      <span className="export-icon export-map">
                        <Map size={17} />
                      </span>
                      <span>
                        <strong>Створити карту</strong>
                      </span>
                    </button>
                    <button
                      className="export-card"
                      onClick={handleExportPlan}
                    >
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
              <label className="select-wrap">
                <Hospital size={15} />
                <select value={facilityFilter} onChange={(event) => setFacilityFilter(event.target.value)}>
                  <option value="all">Усі заклади</option>
                  {facilities.map((facility) => (
                    <option key={facility.id} value={facility.id}>
                      {facility.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </label>
              <label className="search-field search-field-small">
                <Search size={15} />
                <input
                  placeholder="Пошук маршруту"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
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
                        aria-label="Дії"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(route.id);
                        }}
                      >
                        <MoreHorizontal size={18} />
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
              Показано <strong>{firstShown}–{lastShown}</strong> із <strong>{filtered.length}</strong> маршрутів
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

        {draftOpen && (
          <Modal
            title="Новий маршрут CASEVAC"
            subtitle="Крок 1–2: мінне поле та медичний заклад. Геометрія — на етапі 4."
            submitLabel={saving ? 'Створюємо…' : 'Створити чернетку'}
            submitDisabled={saving}
            onClose={() => setDraftOpen(false)}
            onSubmit={() => void submitDraft()}
          >
            <label className="form-label">
              <span className="field-label">Мінне поле <i className="field-required">*</i></span>
              <select
                value={form.taskId}
                onChange={(event) => setForm({ ...form, taskId: event.target.value })}
                required
              >
                <option value="" disabled>
                  Оберіть мінне поле
                </option>
                {minefields.map((minefield) => (
                  <option key={minefield.id} value={minefield.taskId}>
                    {minefield.taskCode}
                    {minefield.name ? ` — ${minefield.name}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label">
              <span className="field-label">Медичний заклад <i className="field-required">*</i></span>
              <select
                value={form.facilityId}
                onChange={(event) => setForm({ ...form, facilityId: event.target.value })}
                required
              >
                <option value="" disabled>
                  Оберіть заклад
                </option>
                {facilities.map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label">
              <span className="field-label">Обстежив маршрут <i className="field-required">*</i></span>
              {medics.length > 0 ? (
                <select
                  value={form.surveyedBy}
                  onChange={(event) => setForm({ ...form, surveyedBy: event.target.value })}
                  required
                >
                  <option value="" disabled>
                    Оберіть медика
                  </option>
                  {medics.map((medic) => (
                    <option key={medic} value={medic}>
                      {medic}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.surveyedBy}
                  onChange={(event) => setForm({ ...form, surveyedBy: event.target.value })}
                  placeholder="ПІБ медика"
                  required
                />
              )}
            </label>
            <label className="form-label">
              <span className="field-label">Дата обстеження <i className="field-required">*</i></span>
              <input
                type="date"
                value={form.surveyDate}
                onChange={(event) => setForm({ ...form, surveyDate: event.target.value })}
                required
              />
            </label>
            <div className="form-info">
              <MapPin size={16} />
              <span>
                Чернетка не містить геометрії: лінію буде намальовано на карті після підключення Sketch (етап
                4). Початкова точка створиться автоматично разом із геометрією.
              </span>
            </div>
          </Modal>
        )}
      </DataStateGate>
    </div>
  );
}
