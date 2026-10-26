import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileText,
  Hospital,
  Layers3,
  Map,
  MapPin,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { DataStateGate, PageFooter, SnapshotNotices } from '../components/PageFooter';
import { SummaryCard } from '../components/SummaryCard';
import { useToast } from '../components/ToastContext';
import { useData } from '../data/DataContext';
import {
  formatCoordinatePair,
  formatDate,
  formatCoordinates,
  routeColor,
  routeStatusLabel,
  routeTypeLabel,
  todayIso,
} from '../lib/format';
import type { RouteType } from '../types';

type RouteFilter = 'all' | 'current' | 'main' | 'additional';

const FILTERS: { id: RouteFilter; label: string }[] = [
  { id: 'all', label: 'Усі маршрути' },
  { id: 'current', label: 'Актуальні' },
  { id: 'main', label: 'Основний' },
  { id: 'additional', label: 'Додатковий' },
];

interface RouteFormState {
  taskId: string;
  facilityId: string;
  routeType: RouteType;
  surveyedBy: string;
  surveyDate: string;
}

const emptyForm = (): RouteFormState => ({
  taskId: '',
  facilityId: '',
  routeType: 'main',
  surveyedBy: '',
  surveyDate: todayIso(),
});

export function RoutesPage() {
  const { snapshot, source, createRoute } = useData();
  const { notify } = useToast();

  const { routes, facilities, minefields, medics } = snapshot;
  const canCreate = source?.capabilities.createRoute === true;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RouteFilter>('all');
  const [facilityFilter, setFacilityFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [form, setForm] = useState<RouteFormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return routes.filter((route) => {
      const matchesQuery =
        needle.length === 0 ||
        `${route.code} ${route.facilityName} ${route.surveyedBy}`.toLowerCase().includes(needle);
      const matchesFacility = facilityFilter === 'all' || route.facilityId === facilityFilter;
      const matchesType =
        filter === 'all' ||
        (filter === 'current' && route.isCurrent) ||
        (filter === 'main' && route.routeType === 'main') ||
        (filter === 'additional' && route.routeType === 'additional');
      return matchesQuery && matchesFacility && matchesType;
    });
  }, [routes, query, facilityFilter, filter]);

  const activeRoute = filtered.find((route) => route.id === selectedId) ?? filtered[0];
  const activeFacility = facilities.find((facility) => facility.id === activeRoute?.facilityId);
  const activeStart = activeRoute?.geometry[0];
  const activeEnd = activeRoute?.geometry[activeRoute.geometry.length - 1];

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
        routeType: form.routeType,
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

  const headingCanCreateTitle = canCreate
    ? 'Створити маршрут'
    : 'Створення маршрутів у режимі Portal буде доступне після підключення геометрії (етап 4).';

  return (
    <div className="page-content">
      <section className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            ПЛАНУВАННЯ ЕВАКУАЦІЇ
          </div>
          <h1>Маршрути CASEVAC</h1>
          <p>Керуйте маршрутами евакуації та пов’язаними медичними закладами.</p>
        </div>
        <div className="heading-actions">
          <button
            className="button button-secondary"
            onClick={() => notify('Керування шарами WebMap з’явиться на етапі 3.')}
          >
            <Layers3 size={17} />
            Шари
          </button>
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

      <SnapshotNotices />

      <DataStateGate>
        <section className="summary-grid">
          <SummaryCard
            label="Усього маршрутів"
            value={String(routes.length).padStart(2, '0')}
            detail="У базі маршрутів"
            tone="neutral"
            icon={<Map size={17} />}
          />
          <SummaryCard
            label="Актуальні маршрути"
            value={String(routes.filter((route) => route.isCurrent).length).padStart(2, '0')}
            detail="Доступні для використання"
            tone="green"
            icon={<Activity size={17} />}
          />
          <SummaryCard
            label="Основні маршрути"
            value={String(routes.filter((route) => route.routeType === 'main').length).padStart(2, '0')}
            detail="Основний напрямок евакуації"
            tone="blue"
            icon={<ArrowRight size={17} />}
          />
          <SummaryCard
            label="Потрібна перевірка"
            value={String(routes.filter((route) => !route.isCurrent).length).padStart(2, '0')}
            detail="Неактуальні або на перегляді"
            tone="amber"
            icon={<CalendarDays size={17} />}
          />
        </section>

        <section className="workspace-grid">
          <div className="map-panel panel">
            <div className="panel-heading">
              <div>
                <div className="section-title">
                  <MapPin size={17} />
                  Карта маршрутів
                </div>
                <span className="section-subtitle">
                  {source?.kind === 'arcgis'
                    ? 'Схематичний перегляд · WebMap підключається на етапі 3'
                    : 'Київська область · попередній перегляд'}
                </span>
              </div>
              <button
                className="icon-button"
                onClick={() => notify('Налаштування карти з’являться після підключення WebMap.')}
                aria-label="Налаштування карти"
              >
                <SlidersHorizontal size={18} />
              </button>
            </div>
            <div className="map-stage">
              <div className="map-top-controls">
                <div className="map-layer-chip">
                  <span className="layer-dot layer-green" />
                  Маршрути
                  <span className="layer-dot layer-orange" />
                  Мінні поля
                </div>
                <button
                  className="map-control-button"
                  onClick={() => notify('Підкладку буде отримано з WebMap.')}
                >
                  <Layers3 size={15} />
                  Підкладка
                </button>
              </div>
              <div className="map-art">
                <div className="map-grid-lines" />
                <svg className="map-rivers" viewBox="0 0 900 520" preserveAspectRatio="none">
                  <path d="M-20 96 C125 164 118 219 250 230 S360 172 434 190 535 287 613 266 723 168 920 228" />
                  <path d="M254 -20 C322 71 271 126 333 180 S481 241 477 330 421 431 485 540" />
                  <path d="M-10 389 C110 340 174 360 215 408 S312 456 390 410 554 341 662 377 791 457 919 411" />
                </svg>
                <div className="terrain terrain-one" />
                <div className="terrain terrain-two" />
                <div className="terrain terrain-three" />
                <div className="road road-one" />
                <div className="road road-two" />
                <div className="road road-three" />
                <div className="road road-four" />
                <div className="road road-five" />
                <span className="map-town town-one">ІРПІНЬ</span>
                <span className="map-town town-two">БУЧА</span>
                <span className="map-town town-three">КИЇВ</span>
                <span className="map-town town-four">ГОСТОМЕЛЬ</span>
                <span className="map-town town-five">ВИШГОРОД</span>
                {filtered.slice(0, 4).map((route, index) => (
                  <div
                    key={route.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(route.id)}
                    className={`map-route route-line-${index + 1} ${routeColor(route)}`}
                  />
                ))}
                {filtered.slice(0, 4).map((route, index) => (
                  <div
                    key={`${route.id}-pin`}
                    className={`map-pin ${index % 2 ? 'hospital-pin' : 'mine-pin'} mine-${index + 1}`}
                  >
                    <span>{index % 2 ? <Hospital size={12} /> : <Activity size={11} />}</span>
                  </div>
                ))}
                <div className="map-scale">
                  <span />
                  10 км
                </div>
                <div className="map-north">
                  N<span>▲</span>
                </div>
                <div className="map-attribution">
                  {source?.kind === 'arcgis'
                    ? 'Схематична карта · дані Portal'
                    : 'Схематична підкладка · демо-дані'}
                </div>
              </div>
              <div className="map-footer">
                <div className="map-coordinate">
                  <MapPin size={14} />
                  <span>{activeStart ? 'Початок маршруту' : 'Координати курсора'}</span>
                  <strong>{activeStart ? formatCoordinates(activeStart) : '—'}</strong>
                </div>
                <span className="map-preview-badge">
                  <span className="status-dot" />
                  {source?.kind === 'arcgis' ? 'Дані Portal' : 'Демо-перегляд'}
                </span>
              </div>
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
                    aria-label="Ще"
                    onClick={() => notify('Додаткові дії будуть доступні після інтеграції редагування.')}
                  >
                    <MoreHorizontal size={19} />
                  </button>
                </div>
                <div className="route-detail-body">
                  <div className="detail-route-heading">
                    <div className={`route-symbol ${routeColor(activeRoute)}`}>
                      <Map size={18} />
                    </div>
                    <div>
                      <div className="detail-code">{activeRoute.code}</div>
                      <div className="detail-meta">{routeTypeLabel(activeRoute.routeType)} маршрут</div>
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
                    <div className="route-direction">
                      <div>
                        <span className="direction-point mine-point">
                          <Activity size={13} />
                        </span>
                        <span>Мінне поле</span>
                      </div>
                      <div className="direction-track">
                        <span />
                        <ArrowRight size={14} />
                      </div>
                      <div>
                        <span className="direction-point hospital-point">
                          <Hospital size={13} />
                        </span>
                        <span>Медзаклад</span>
                      </div>
                    </div>
                  </div>
                  <div className="detail-coordinates">
                    <div>
                      <span>ПОЧАТОК</span>
                      <strong>{activeStart ? formatCoordinatePair(activeStart) : '—'}</strong>
                    </div>
                    <ArrowRight size={14} />
                    <div>
                      <span>КІНЕЦЬ</span>
                      <strong>{activeEnd ? formatCoordinatePair(activeEnd) : '—'}</strong>
                    </div>
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
                        <small>Зберегти маршрут як JPG</small>
                      </span>
                      <ArrowRight size={16} />
                    </button>
                    <button
                      className="export-card"
                      onClick={() =>
                        notify(`Експорт Плану реагування для ${activeRoute.code} — етап 6 плану.`)
                      }
                    >
                      <span className="export-icon export-doc">
                        <FileText size={17} />
                      </span>
                      <span>
                        <strong>Експортувати План реагування</strong>
                        <small>Завантажити документ Word</small>
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  <button
                    className="edit-route-button"
                    onClick={() =>
                      notify(
                        'Редагування геометрії потребує підключення Sketch та Feature Service (етап 4).',
                        'info',
                      )
                    }
                  >
                    <SlidersHorizontal size={16} />
                    Редагувати маршрут
                  </button>
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
          <div className="list-header">
            <div>
              <div className="section-title">
                Список маршрутів <span className="list-count">{filtered.length}</span>
              </div>
              <span className="section-subtitle">Актуальний перелік маршрутів евакуації</span>
            </div>
            <button
              className="button button-quiet"
              onClick={() => notify('Розширені фільтри буде додано пізніше.', 'info')}
            >
              <SlidersHorizontal size={15} />
              Фільтри
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="list-toolbar">
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
          </div>
          <div className="route-table-wrap">
            <table className="route-table">
              <thead>
                <tr>
                  <th>МАРШРУТ</th>
                  <th>МЕДИЧНИЙ ЗАКЛАД</th>
                  <th>ТИП</th>
                  <th>СТАТУС</th>
                  <th>ОБСТЕЖЕНО</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((route) => (
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
                        className={`type-badge ${route.routeType === 'main' ? 'type-primary' : 'type-secondary'}`}
                      >
                        <i />
                        {routeTypeLabel(route.routeType)}
                      </span>
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
              Показано <strong>{filtered.length}</strong> із <strong>{routes.length}</strong> маршрутів
            </span>
            <span>
              {source?.kind === 'arcgis' ? 'Дані Portal · лише читання' : 'Чернетка інтерфейсу · демо-дані'}
            </span>
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
              <span className="field-label">Тип маршруту</span>
              <select
                value={form.routeType}
                onChange={(event) => setForm({ ...form, routeType: event.target.value as RouteType })}
              >
                <option value="main">Основний</option>
                <option value="additional">Додатковий</option>
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
