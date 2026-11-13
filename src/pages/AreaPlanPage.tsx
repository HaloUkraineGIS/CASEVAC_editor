import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { FileText, Globe2, Loader2, Map, MapPin } from 'lucide-react';
import { DataStateGate, SnapshotNotices } from '../components/PageFooter';
import { useToast } from '../components/ToastContext';
import { useData } from '../data/DataContext';
import {
  ALL_REGIONS,
  filterActiveFacilities,
  filterFacilitiesByRegion,
  groupFacilitiesByRegion,
} from '../lib/facilityRegion';
import { exportRegionResponsePlan } from '../lib/regionDocxExport';
import { REGION_TEMPLATE_URL } from '../lib/templates';

const FacilitiesMap = lazy(() =>
  import('../components/FacilitiesMap').then((module) => ({ default: module.FacilitiesMap })),
);

const AreaMapExportModal = lazy(() =>
  import('../components/AreaMapExportModal').then((module) => ({
    default: module.AreaMapExportModal,
  })),
);

/** «1 заклад», «2 заклади», «5 закладів». */
function facilityCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} заклад`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} заклади`;
  return `${count} закладів`;
}

export function AreaPlanPage() {
  const { notify } = useToast();
  const { snapshot, source } = useData();
  // На сторінці показуємо лише активні заклади (is_active = yes).
  const facilities = useMemo(
    () => filterActiveFacilities(snapshot.facilities),
    [snapshot.facilities],
  );
  const facilitySchema = snapshot.facilitySchema;
  const [selectedRegion, setSelectedRegion] = useState<string>(ALL_REGIONS);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [mapExportOpen, setMapExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const regionGroups = useMemo(
    () => groupFacilitiesByRegion(facilities, facilitySchema),
    [facilities, facilitySchema],
  );
  const visibleFacilities = useMemo(
    () => filterFacilitiesByRegion(facilities, selectedRegion, facilitySchema),
    [facilities, selectedRegion, facilitySchema],
  );

  // Якщо вибрана область зникла з даних — повертаємось до повного переліку.
  useEffect(() => {
    if (selectedRegion === ALL_REGIONS) return;
    if (regionGroups.some((group) => group.region === selectedRegion)) return;
    setSelectedRegion(ALL_REGIONS);
    setSelectedFacilityId(null);
  }, [regionGroups, selectedRegion]);

  const selectRegion = (region: string) => {
    setSelectedRegion(region);
    setSelectedFacilityId(null);
  };

  const canExport = selectedRegion !== ALL_REGIONS && visibleFacilities.length > 0;
  const exportTitle =
    selectedRegion === ALL_REGIONS
      ? 'Оберіть область у таблиці ліворуч'
      : visibleFacilities.length === 0
        ? 'Для цієї області немає медичних закладів'
        : 'Сформувати DOCX для вибраної області';

  const canCreateMap = canExport;
  const mapTitle =
    selectedRegion === ALL_REGIONS
      ? 'Оберіть область у таблиці ліворуч'
      : visibleFacilities.length === 0
        ? 'Для цієї області немає медичних закладів'
        : 'Налаштувати та експортувати карту області у форматі A3';

  const handleExportPlan = async () => {
    if (!canExport || exporting) return;
    setExporting(true);
    try {
      notify('Генеруємо план реагування…', 'info');
      await exportRegionResponsePlan({
        region: selectedRegion,
        facilities: visibleFacilities,
        schema: facilitySchema,
        templatePath: REGION_TEMPLATE_URL,
      });
      notify(`План реагування для області «${selectedRegion}» завантажено.`, 'success');
    } catch (error) {
      console.error('Помилка експорту плану області:', error);
      notify(error instanceof Error ? error.message : 'Не вдалося згенерувати документ', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page-content">
      <section className="page-heading">
        <div>
          <h1>План реагування на область</h1>
        </div>
        <div className="heading-actions">
          <button
            className="button button-secondary"
            onClick={() => setMapExportOpen(true)}
            disabled={!canCreateMap}
            title={mapTitle}
          >
            <Map size={17} />
            Створити карту
          </button>
          <button
            className="button button-primary"
            onClick={() => void handleExportPlan()}
            disabled={!canExport || exporting}
            title={exporting ? 'Генеруємо документ…' : exportTitle}
          >
            {exporting ? <Loader2 size={17} className="spin" /> : <FileText size={17} />}
            {exporting ? 'Генеруємо…' : 'План реагування'}
          </button>
        </div>
      </section>

      <SnapshotNotices />

      <DataStateGate>
        <section className="area-plan-grid">
          <div className="panel area-plan-panel">
            <div className="list-header">
              <div>
                <div className="section-title">
                  Області <span className="list-count">{regionGroups.length}</span>
                </div>
                <span className="section-subtitle">Значення поля «Область» шару закладів</span>
              </div>
            </div>
            <div className="plan-list area-plan-list">
              <button
                type="button"
                className={`plan-row ${selectedRegion === ALL_REGIONS ? 'selected' : ''}`}
                onClick={() => selectRegion(ALL_REGIONS)}
              >
                <span className="plan-row-icon">
                  <Globe2 size={16} />
                </span>
                <span className="plan-row-main">
                  <strong>Усі області</strong>
                  <span>{facilityCountLabel(facilities.length)}</span>
                </span>
              </button>
              {regionGroups.map((group) => (
                <button
                  type="button"
                  key={group.region}
                  className={`plan-row ${selectedRegion === group.region ? 'selected' : ''}`}
                  onClick={() => selectRegion(group.region)}
                >
                  <span className="plan-row-icon">
                    <MapPin size={16} />
                  </span>
                  <span className="plan-row-main">
                    <strong>{group.region}</strong>
                    <span>{facilityCountLabel(group.facilities.length)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <aside className="panel facility-map-panel area-plan-map-panel">
            <div className="facility-map-panel-head">
              <span>
                {selectedRegion === ALL_REGIONS ? 'Усі заклади на карті' : selectedRegion}
              </span>
              <span className="facility-map-source">
                {source?.kind === 'arcgis'
                  ? 'Веб-карта Portal · Medical facilities'
                  : 'Базова карта · демо-дані'}
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
                facilities={visibleFacilities}
                selectedId={selectedFacilityId}
                onSelect={setSelectedFacilityId}
                filterActive={selectedRegion !== ALL_REGIONS}
                fitKey={selectedRegion}
                expanded={mapExpanded}
                onToggleExpand={() => setMapExpanded((expanded) => !expanded)}
              />
            </Suspense>
            {mapExpanded && (
              <div
                className="facilities-map-backdrop"
                onClick={() => setMapExpanded(false)}
                aria-hidden="true"
              />
            )}
          </aside>
        </section>
      </DataStateGate>

      {mapExportOpen && canCreateMap && (
        <Suspense fallback={null}>
          <AreaMapExportModal
            region={selectedRegion}
            facilities={visibleFacilities}
            onClose={() => setMapExportOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
