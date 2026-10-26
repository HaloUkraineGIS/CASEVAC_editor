import { useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Globe2,
  Hospital,
  Layers3,
  Map,
  MapPin,
  Route,
} from 'lucide-react';
import { PageFooter } from '../components/PageFooter';
import { SummaryCard } from '../components/SummaryCard';
import { useToast } from '../components/ToastContext';
import { areaPlans, planStatusLabel, type AreaPlan } from '../data/planData';
import { formatDate } from '../lib/format';

function statusClass(plan: AreaPlan): string {
  if (plan.status === 'actual') return 'status-current';
  if (plan.status === 'draft') return 'status-draft';
  return 'status-outdated';
}

export function AreaPlanPage() {
  const { notify } = useToast();
  const [selectedId, setSelectedId] = useState(areaPlans[0]?.id ?? '');
  const selected = areaPlans.find((plan) => plan.id === selectedId) ?? areaPlans[0];

  const totalFacilities = areaPlans.reduce((sum, plan) => sum + plan.facilitiesCount, 0);
  const totalRoutes = areaPlans.reduce((sum, plan) => sum + plan.routesCount, 0);
  const actualCount = areaPlans.filter((plan) => plan.status === 'actual').length;
  const documentsCount = areaPlans.reduce((sum, plan) => sum + plan.documents.length, 0);

  return (
    <div className="page-content">
      <section className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            ПЛАНУВАННЯ РЕАГУВАННЯ
          </div>
          <h1>План реагування на область</h1>
          <p>Стан планів реагування за областями, їхній склад і готовність до формування.</p>
        </div>
        <div className="heading-actions">
          <button
            className="button button-secondary"
            onClick={() => notify('Шаблон NTS_EORE буде завантажуватися з Portal (FR-33).', 'info')}
          >
            <Layers3 size={17} />
            Шаблон
          </button>
          <button
            className="button button-primary"
            onClick={() => notify('Формування плану області — етап 6 (DOCX) і етап 5 (карта).', 'info')}
          >
            <FileText size={17} />
            Сформувати план
          </button>
        </div>
      </section>

      <section className="summary-grid">
        <SummaryCard
          label="Області у роботі"
          value={String(areaPlans.length).padStart(2, '0')}
          detail="У переліку планів реагування"
          tone="neutral"
          icon={<Globe2 size={17} />}
        />
        <SummaryCard
          label="Актуальні плани"
          value={String(actualCount).padStart(2, '0')}
          detail="Готові до використання"
          tone="green"
          icon={<CheckCircle2 size={17} />}
        />
        <SummaryCard
          label="Закладів у планах"
          value={String(totalFacilities).padStart(2, '0')}
          detail={`${totalRoutes} маршрутів CASEVAC`}
          tone="blue"
          icon={<Hospital size={17} />}
        />
        <SummaryCard
          label="Документів плану"
          value={String(documentsCount).padStart(2, '0')}
          detail="Основний документ і карта"
          tone="amber"
          icon={<FileText size={17} />}
        />
      </section>

      <section className="plan-grid">
        <div className="panel plan-list-panel">
          <div className="list-header">
            <div>
              <div className="section-title">
                Області <span className="list-count">{areaPlans.length}</span>
              </div>
              <span className="section-subtitle">Виберіть область для перегляду складу плану</span>
            </div>
          </div>
          <div className="plan-list">
            {areaPlans.map((plan) => (
              <button
                key={plan.id}
                className={`plan-row ${selected?.id === plan.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(plan.id)}
              >
                <span className="plan-row-icon">
                  <MapPin size={16} />
                </span>
                <span className="plan-row-main">
                  <strong>{plan.region}</strong>
                  <span>
                    {plan.facilitiesCount} закладів · {plan.routesCount} маршрутів
                  </span>
                </span>
                <span className="plan-row-meta">
                  <span className={`status-badge ${statusClass(plan)}`}>
                    <span />
                    {planStatusLabel(plan.status)}
                  </span>
                  <span>{formatDate(plan.updatedAt)}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="table-footer">
            <span>Демонстраційні дані</span>
            <span>Джерело: шаблон NTS_EORE</span>
          </div>
        </div>

        {selected && (
          <div className="panel plan-detail-panel">
            <div className="panel-heading">
              <div>
                <div className="section-title">
                  <Globe2 size={17} />
                  {selected.region}
                </div>
                <span className="section-subtitle">
                  Код області {selected.code} · оновлено {formatDate(selected.updatedAt)}
                </span>
              </div>
              <span className={`status-badge ${statusClass(selected)}`}>
                <span />
                {planStatusLabel(selected.status)}
              </span>
            </div>

            <div className="plan-detail-body">
              <div className="coverage-block">
                <div className="coverage-head">
                  <span>Готовність плану</span>
                  <strong>{selected.coverage}%</strong>
                </div>
                <div className="coverage-track">
                  <span style={{ width: `${selected.coverage}%` }} />
                </div>
                <div className="coverage-note">
                  {selected.documents.length > 0
                    ? `${selected.documents.length} документ(и) у складі плану`
                    : 'Документи ще не сформовані'}
                </div>
              </div>

              <div>
                <span className="detail-label">СКЛАД ПЛАНУ</span>
                <div className="checklist">
                  {selected.sections.map((section) => (
                    <div key={section.id} className={`checklist-row ${section.ready ? '' : 'pending'}`}>
                      {section.ready ? <CheckCircle2 size={15} /> : <Clock size={15} />}
                      <span>{section.title}</span>
                      <span>{section.note}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <span className="detail-label">ДОКУМЕНТИ</span>
                {selected.documents.length > 0 ? (
                  <div className="doc-list">
                    {selected.documents.map((document) => (
                      <button
                        key={document.id}
                        className="doc-row"
                        onClick={() =>
                          notify(
                            `Перегляд «${document.name}» буде доступний після експорту (етап 6).`,
                            'info',
                          )
                        }
                      >
                        <span className={`doc-icon ${document.kind === 'plan' ? 'plan' : ''}`}>
                          {document.kind === 'plan' ? <FileText size={15} /> : <Map size={15} />}
                        </span>
                        <span className="doc-copy">
                          <strong>{document.name}</strong>
                          <span>
                            {document.note} · {formatDate(document.updatedAt)}
                          </span>
                        </span>
                        <ArrowRight size={15} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="doc-empty">Для цієї області документи ще не сформовані.</div>
                )}
              </div>
            </div>

            <div className="plan-actions">
              <button
                className="button button-primary"
                onClick={() => notify('Формування плану області заплановано на етап 6.', 'info')}
              >
                <FileText size={16} />
                Сформувати план
              </button>
              <button
                className="button button-secondary"
                onClick={() => notify('Експорт карти закладів області — етап 5 (A4/A3, 300 dpi).', 'info')}
              >
                <Map size={16} />
                Карта закладів
              </button>
            </div>

            <div className="plan-hint">
              <CalendarDays size={15} />
              <span>
                Дані областей у цьому прототипі демонстраційні. Підключення до шарів Portal, перевірка
                актуальності маршрутів і формування DOCX — етапи 3, 6 і 9 плану.
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="facility-note">
        <span className="facility-note-icon">
          <Route size={18} />
        </span>
        <div>
          <strong>Склад плану визначається Додатками Б і В</strong>
          <span>
            Розділи, порядок документів і макет карти буде уточнено після отримання шаблону реагування та
            опису макета CASEVAC.
          </span>
        </div>
      </section>

      <PageFooter note="Плани реагування на область" />
    </div>
  );
}
