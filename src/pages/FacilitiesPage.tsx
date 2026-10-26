import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Hospital,
  Layers3,
  Map,
  MapPin,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { FacilityForm } from '../components/FacilityForm';
import { Modal } from '../components/Modal';
import { DataStateGate, PageFooter, SnapshotNotices } from '../components/PageFooter';
import { SummaryCard } from '../components/SummaryCard';
import { useToast } from '../components/ToastContext';
import { appConfig } from '../config/appConfig';
import { useData } from '../data/DataContext';
import {
  applyLocationToValues,
  applyVisitDefaults,
  displayFieldValue,
  initialFacilityValues,
  validateFacilityValues,
} from '../lib/facilitySchema';
import { formatCoordinates, formatDate, isVisitStale, monthsSince, todayIso } from '../lib/format';
import type { FacilityRecord, LonLat } from '../types';

const FacilitiesMap = lazy(() =>
  import('../components/FacilitiesMap').then((module) => ({ default: module.FacilitiesMap })),
);

function visitLabel(facility: FacilityRecord): string {
  if (isVisitStale(facility.lastVisitDate)) return 'Потрібен візит';
  return 'Перевірено';
}

function visitHint(facility: FacilityRecord): string {
  const months = monthsSince(facility.lastVisitDate);
  if (months === null) return 'Дата візиту не вказана';
  if (months === 0) return 'Візит цього місяця';
  return `${months} міс. без візиту`;
}

export function FacilitiesPage() {
  const { snapshot, source, reload, createFacility, updateFacility, deleteFacility } = useData();
  const { user } = useAuth();
  const { notify } = useToast();
  const { facilities, routes, medics, facilitySchema: schema } = snapshot;

  const [query, setQuery] = useState('');
  const [viewId, setViewId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingRecord, setEditingRecord] = useState<FacilityRecord | null>(null);
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [location, setLocation] = useState<LonLat | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [locationError, setLocationError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FacilityRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canCreate = schema?.capabilities.create ?? source?.capabilities.createFacility === true;
  const canUpdate = schema?.capabilities.update ?? source?.capabilities.editFacility === true;
  const canDelete = schema?.capabilities.delete ?? source?.capabilities.deleteFacility === true;
  const staleThreshold = appConfig.facilities.visitStaleMonths;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return facilities;
    return facilities.filter((facility) =>
      `${facility.name} ${facility.type} ${facility.address} ${facility.departments}`
        .toLowerCase()
        .includes(needle),
    );
  }, [facilities, query]);

  const activeRoutes = routes.filter((route) => route.isCurrent).length;
  const needsVisit = facilities.filter((facility) => isVisitStale(facility.lastVisitDate)).length;
  const viewed = facilities.find((facility) => facility.id === viewId) ?? null;
  const selected = facilities.find((facility) => facility.id === selectedId) ?? null;
  const viewedRoutes = viewed ? routes.filter((route) => route.facilityId === viewed.id) : [];
  const deleteRoutes = deleteTarget ? routes.filter((route) => route.facilityId === deleteTarget.id) : [];

  const openDetails = (facility: FacilityRecord) => {
    setSelectedId(facility.id);
    setViewId(facility.id);
  };

  // Вибір закладу на карті підсвічує рядок у списку й прокручує до нього.
  useEffect(() => {
    if (!selectedId) return;
    const row = document.getElementById(`facility-row-${selectedId}`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  const currentUserName = (record?: FacilityRecord | null): string =>
    user?.fullName?.trim() || user?.username || record?.visitedBy || '';

  const openCreate = () => {
    if (!schema) {
      notify('Схема шару закладів ще не завантажена. Оновіть дані.', 'error');
      return;
    }
    const base = initialFacilityValues(schema);
    setValues(applyVisitDefaults(schema, base, todayIso(), currentUserName()));
    setLocation(undefined);
    setErrors({});
    setLocationError('');
    setEditingRecord(null);
    setFormMode('create');
  };

  const openEdit = (record: FacilityRecord) => {
    if (!schema) {
      notify('Схема шару закладів ще не завантажена. Оновіть дані.', 'error');
      return;
    }
    const base = initialFacilityValues(schema, record);
    setValues(applyLocationToValues(schema, applyVisitDefaults(schema, base, todayIso(), currentUserName(record)), record.location));
    setLocation(record.location);
    setErrors({});
    setLocationError('');
    setEditingRecord(record);
    setSelectedId(record.id);
    setViewId(null);
    setFormMode('edit');
  };

  const handleFieldChange = (name: string, value: string | number) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!current[name]) return current;
      const updated = { ...current };
      delete updated[name];
      return updated;
    });
  };

  const handleLocationChange = (point?: LonLat) => {
    setLocation(point);
    if (point) setLocationError('');
    setValues((current) => applyLocationToValues(schema, current, point));
  };

  const submitForm = async () => {
    if (!schema || !formMode) return;
    const { errors: nextErrors, firstInvalid } = validateFacilityValues(schema, values);
    setErrors(nextErrors);
    if (firstInvalid) {
      notify(nextErrors[firstInvalid] ?? 'Перевірте заповнення форми', 'error');
      return;
    }
    if (formMode === 'create' && !location) {
      setLocationError('Вкажіть точку закладу на карті або введіть координати.');
      notify('Вкажіть точку закладу на карті або введіть координати.', 'error');
      return;
    }
    setLocationError('');
    setSaving(true);
    try {
      if (formMode === 'create') {
        await createFacility({ attributes: values, location });
        notify('Заклад створено. Дані збережено в сервісі.', 'success');
      } else if (editingRecord) {
        await updateFacility(editingRecord, { attributes: values, location });
        notify('Зміни картки збережено.', 'success');
      }
      setFormMode(null);
      setEditingRecord(null);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Не вдалося зберегти заклад', 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteFacility(deleteTarget);
      notify(`Заклад «${deleteTarget.name}» видалено.`, 'success');
      setDeleteTarget(null);
      setViewId(null);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Не вдалося видалити заклад', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleReload = async () => {
    const ok = await reload();
    if (ok) notify('Дані оновлено з поточного джерела.');
  };

  return (
    <div className="page-content">
      <section className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            МЕРЕЖА МЕДИЧНОЇ ДОПОМОГИ
          </div>
          <h1>Медичні заклади</h1>
          <p>Актуальна інформація про лікарні та їхні можливості.</p>
        </div>
        <div className="heading-actions">
          <button className="button button-secondary" onClick={() => void handleReload()}>
            <Layers3 size={16} />
            Оновити дані
          </button>
          <button
            className="button button-primary"
            onClick={openCreate}
            disabled={!canCreate}
            title={canCreate ? 'Додати заклад' : 'Сервіс не дозволяє створення закладів'}
          >
            <Plus size={18} />
            Додати заклад
          </button>
        </div>
      </section>

      <SnapshotNotices />

      <DataStateGate>
        <section className="summary-grid">
          <SummaryCard
            label="Усього закладів"
            value={String(facilities.length).padStart(2, '0')}
            detail="У реєстрі медичного відділу"
            tone="neutral"
            icon={<Building2 size={17} />}
          />
          <SummaryCard
            label="Перевірені"
            value={String(facilities.length - needsVisit).padStart(2, '0')}
            detail={`Візит не давніше ${staleThreshold} міс.`}
            tone="green"
            icon={<ShieldCheck size={17} />}
          />
          <SummaryCard
            label="Потрібен візит"
            value={String(needsVisit).padStart(2, '0')}
            detail="Дані слід оновити"
            tone="amber"
            icon={<CalendarDays size={17} />}
          />
          <SummaryCard
            label="Активні маршрути"
            value={String(activeRoutes).padStart(2, '0')}
            detail="Пов’язані із закладами"
            tone="blue"
            icon={<Map size={17} />}
          />
        </section>

        <section className="facilities-panel panel">
          <div className="list-header">
            <div>
              <div className="section-title">
                Реєстр закладів <span className="list-count">{filtered.length}</span>
              </div>
              <span className="section-subtitle">Картки закладів та атрибутивні дані</span>
            </div>
            <button
              className="button button-quiet"
              onClick={() => notify('Групування буде додано пізніше.', 'info')}
            >
              <Building2 size={15} />
              Групувати
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="facility-toolbar">
            <label className="search-field search-field-wide">
              <Search size={16} />
              <input
                placeholder="Пошук за назвою, типом, адресою або відділенням"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button
              className="icon-button filter-square"
              onClick={() => notify('Розширені фільтри з’являться на наступному етапі.', 'info')}
              aria-label="Фільтри"
            >
              <SlidersHorizontal size={17} />
            </button>
          </div>
          <div className="facilities-workspace">
            <div className="facility-list">
              {filtered.map((facility, index) => {
                const stale = isVisitStale(facility.lastVisitDate);
                const facilityRoutes = routes.filter((route) => route.facilityId === facility.id);
                const isSelected = selectedId === facility.id;
                return (
                  <article
                    className={`facility-row ${isSelected ? 'facility-row-selected' : ''}`}
                    key={facility.id}
                    id={`facility-row-${facility.id}`}
                    onClick={() => setSelectedId(facility.id)}
                  >
                    <div className={`facility-avatar facility-avatar-${index % 4}`}>
                      <Hospital size={19} />
                    </div>
                    <div className="facility-main">
                      <div className="facility-title-row">
                        <h3>{facility.name}</h3>
                        <span
                          className={`facility-status ${stale ? 'facility-needs-visit' : 'facility-verified'}`}
                        >
                          <span />
                          {visitLabel(facility)}
                        </span>
                      </div>
                      <div className="facility-meta">
                        <span>
                          <Building2 size={14} />
                          {facility.type || 'Тип не вказано'}
                        </span>
                        <span>
                          <MapPin size={14} />
                          {facility.address || 'Адреса не вказана'}
                        </span>
                      </div>
                      <div className="facility-departments">
                        <Stethoscope size={14} />
                        <span>{facility.departments || 'Відділення не вказані'}</span>
                      </div>
                      <div className="facility-meta-visit">
                        <CalendarDays size={14} />
                        <span>
                          Візит: {formatDate(facility.lastVisitDate, 'не було')} · {visitHint(facility)}
                        </span>
                      </div>
                    </div>
                    <div className="facility-visit">
                      <span>ОСТАННІЙ ВІЗИТ</span>
                      <strong>{formatDate(facility.lastVisitDate, 'Не було')}</strong>
                      <small>{visitHint(facility)}</small>
                    </div>
                    <div className="facility-route-count">
                      <span>МАРШРУТИ</span>
                      <strong>{facilityRoutes.length.toString().padStart(2, '0')}</strong>
                    </div>
                    <button
                      className="button button-row-edit"
                      onClick={(event) => {
                        event.stopPropagation();
                        openDetails(facility);
                      }}
                    >
                      Переглянути
                      <ChevronRight size={15} />
                    </button>
                  </article>
                );
              })}
              {filtered.length === 0 && (
                <div className="no-results">
                  <Search size={21} />
                  <strong>Закладів не знайдено</strong>
                  <span>Змініть пошуковий запит.</span>
                </div>
              )}
            </div>

            <aside className="facility-map-panel">
              <div className="facility-map-panel-head">
                <span>Усі заклади на карті</span>
                <span className="facility-map-legend">
                  <i className="legend-verified" />
                  Перевірені
                  <i className="legend-stale" />
                  Потрібен візит
                </span>
              </div>
              <Suspense
                fallback={
                  <div className="facility-map-skeleton">
                    <span>Готуємо карту…</span>
                  </div>
                }
              >
                <FacilitiesMap
                  facilities={filtered}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </Suspense>
              {selected ? (
                <div className="facility-map-selected">
                  <div>
                    <strong>{selected.name}</strong>
                    <span>{selected.type || 'Тип не вказано'}</span>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => openDetails(selected)}
                  >
                    Відкрити картку
                  </button>
                </div>
              ) : (
                <div className="facility-map-selected facility-map-selected-empty">
                  Оберіть заклад на карті або в списку
                </div>
              )}
            </aside>
          </div>
          <div className="table-footer">
            <span>
              Показано <strong>{filtered.length}</strong> із <strong>{facilities.length}</strong> закладів
            </span>
            <span>
              {source?.kind === 'arcgis'
                ? 'Дані Portal · Feature Service'
                : 'Демо-дані · зміни лише в пам’яті'}
            </span>
          </div>
        </section>

        <section className="facility-note">
          <span className="facility-note-icon">
            <CircleHelp size={18} />
          </span>
          <div>
            <strong>
              {schema?.source === 'arcgis'
                ? 'Форма побудована зі схеми шару'
                : 'Демонстраційна схема картки'}
            </strong>
            <span>
              {schema
                ? `${schema.fields.length} полів · ${schema.sections.length} розділів · домени, обов’язковість і типи беруться з метаданих сервісу.`
                : 'Схема полів недоступна. Оновіть дані після входу через Portal.'}
            </span>
          </div>
        </section>

        <PageFooter note="Реєстр медичних закладів" />

        {formMode && schema && (
          <Modal
            wide
            title={formMode === 'create' ? 'Новий медичний заклад' : 'Редагування закладу'}
            subtitle={
              formMode === 'create'
                ? 'Точка на карті, атрибути та фіксація візиту'
                : `${editingRecord?.name ?? 'Картка закладу'} · ${schema.layerTitle}`
            }
            onClose={() => setFormMode(null)}
            onSubmit={() => void submitForm()}
            submitDisabled={saving}
            footer={
              <>
                <span className="modal-footer-note">
                  {schema.source === 'arcgis'
                    ? 'Збереження через applyEdits'
                    : 'Демо-режим: зміни не зберігаються на сервері'}
                </span>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setFormMode(null)}
                >
                  Скасувати
                </button>
                <button type="submit" className="button button-primary" disabled={saving}>
                  {saving ? 'Зберігаємо…' : formMode === 'create' ? 'Створити заклад' : 'Зберегти зміни'}
                </button>
              </>
            }
          >
            <FacilityForm
              schema={schema}
              values={values}
              errors={errors}
              location={location}
              locationError={locationError}
              facilities={facilities}
              medics={medics}
              onChange={handleFieldChange}
              onLocationChange={handleLocationChange}
            />
          </Modal>
        )}

        {viewed && (
          <Modal
            wide
            title={viewed.name}
            subtitle={`${viewed.type || 'Тип не вказано'} · ${visitLabel(viewed)}`}
            onClose={() => setViewId(null)}
            footer={
              <>
                {canDelete && (
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => setDeleteTarget(viewed)}
                    disabled={viewedRoutes.length > 0}
                    title={
                      viewedRoutes.length > 0
                        ? 'Спочатку перенесіть або деактивуйте пов’язані маршрути'
                        : 'Видалити заклад'
                    }
                  >
                    <Trash2 size={15} />
                    Видалити
                  </button>
                )}
                <span className="modal-footer-spacer" />
                <button type="button" className="button button-secondary" onClick={() => setViewId(null)}>
                  Закрити
                </button>
                {canUpdate && (
                  <button type="button" className="button button-primary" onClick={() => openEdit(viewed)}>
                    <Pencil size={15} />
                    Редагувати
                  </button>
                )}
              </>
            }
          >
            <div className="facility-detail-meta">
              <span>
                <MapPin size={13} />
                {viewed.location ? formatCoordinates(viewed.location) : 'Координати не вказані'}
              </span>
              <span>
                <CalendarDays size={13} />
                Останній візит: {formatDate(viewed.lastVisitDate, 'не було')}
              </span>
            </div>

            {schema ? (
              <div className="detail-sections">
                {schema.sections.map((section) => (
                  <section key={section.id} className="detail-section">
                    <h3>
                      {section.title}
                      <span>{section.fields.length}</span>
                    </h3>
                    <div className="detail-grid">
                      {section.fields.map((field) => {
                        const value = displayFieldValue(field, viewed.attributes[field.name]);
                        return (
                          <div
                            key={field.name}
                            className={`detail-cell ${field.kind === 'longText' ? 'detail-cell-wide' : ''}`}
                          >
                            <span>{field.alias}</span>
                            <strong>{value || '—'}</strong>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="info-grid">
                <div className="info-cell">
                  <span>АДРЕСА</span>
                  <strong>{viewed.address || 'Не вказано'}</strong>
                </div>
                <div className="info-cell">
                  <span>ВІДДІЛЕННЯ</span>
                  <strong>{viewed.departments || 'Не вказано'}</strong>
                </div>
              </div>
            )}

            <div className="info-block">
              <span className="detail-label">ПОВ’ЯЗАНІ МАРШРУТИ</span>
              {viewedRoutes.length > 0 ? (
                <div className="chip-row">
                  {viewedRoutes.map((route) => (
                    <span key={route.id} className="info-chip">
                      {route.code} · {route.isCurrent ? 'актуальний' : 'неактуальний'}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="info-empty">Маршрутів до цього закладу немає.</span>
              )}
              {viewedRoutes.length > 0 && (
                <span className="detail-hint">
                  Видалення заборонене (FR-13), доки на заклад посилається хоча б один маршрут.
                </span>
              )}
            </div>
          </Modal>
        )}

        {deleteTarget && (
          <Modal
            title="Видалити медичний заклад?"
            subtitle={deleteTarget.name}
            info
            onClose={() => setDeleteTarget(null)}
            footer={
              <>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setDeleteTarget(null)}
                >
                  Скасувати
                </button>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() => void confirmDelete()}
                  disabled={deleting || deleteRoutes.length > 0}
                >
                  <Trash2 size={15} />
                  {deleting ? 'Видаляємо…' : 'Видалити заклад'}
                </button>
              </>
            }
          >
            {deleteRoutes.length > 0 ? (
              <div className="form-warning">
                <AlertTriangle size={17} />
                <div>
                  <strong>Видалення заборонене</strong>
                  <span>
                    На заклад посилаються маршрути:{' '}
                    {deleteRoutes.map((route) => route.code || route.id).join(', ')}. Спершу перенесіть
                    або деактивуйте ці маршрути (FR-13).
                  </span>
                </div>
              </div>
            ) : (
              <div className="form-warning form-warning-neutral">
                <AlertTriangle size={17} />
                <div>
                  <strong>Дію не можна скасувати</strong>
                  <span>
                    Картку буде видалено з шару {schema?.layerTitle ?? 'медичних закладів'} через
                    applyEdits. Пов’язаних маршрутів немає.
                  </span>
                </div>
              </div>
            )}
          </Modal>
        )}
      </DataStateGate>
    </div>
  );
}
