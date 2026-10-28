import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Hospital,
  MapPin,
  Route,
  ShieldAlert,
} from 'lucide-react';
import { PageFooter } from '../components/PageFooter';
import { SummaryCard } from '../components/SummaryCard';
import { useToast } from '../components/ToastContext';
import { eodPlans, planStatusLabel, type EodPlan } from '../data/planData';
import { formatDate } from '../lib/format';

function statusClass(plan: EodPlan): string {
  if (plan.status === 'actual') return 'status-current';
  if (plan.status === 'draft') return 'status-draft';
  return 'status-outdated';
}

export function EodPlanPage() {
  const { notify } = useToast();
  const [selectedId, setSelectedId] = useState(eodPlans[0]?.id ?? '');
  const selected = eodPlans.find((plan) => plan.id === selectedId) ?? eodPlans[0];

  const readyCount = eodPlans.filter((plan) => plan.status === 'actual').length;
  const draftCount = eodPlans.filter((plan) => plan.status === 'draft').length;
  const outdatedCount = eodPlans.filter((plan) => plan.status === 'outdated').length;

  return (
    <div className="page-content">
      <section className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            ПЛАНИ ДЛЯ ЗАВДАНЬ EOD
          </div>
          <h1>Маршрути CASEVAC CDS</h1>
          <p>Плани CASEVAC для завдань з розмінування та стан їхньої готовності.</p>
        </div>
        <div className="heading-actions">
          <button
            className="button button-secondary"
            onClick={() =>
              notify('Шаблони EOD зберігаються окремо й будуть завантажуватися з Portal.', 'info')
            }
          >
            <FileText size={16} />
            Шаблони EOD
          </button>
          <button
            className="button button-primary"
            onClick={() => notify('Створення EOD-плану: потрібні шаблон, маршрут і заклад (етап 6).', 'info')}
          >
            <ShieldAlert size={17} />
            Створити план
          </button>
        </div>
      </section>

      <section className="summary-grid">
        <SummaryCard
          label="Завдань EOD"
          value={String(eodPlans.length).padStart(2, '0')}
          detail="У поточному переліку"
          tone="neutral"
          icon={<ShieldAlert size={17} />}
        />
        <SummaryCard
          label="Готові плани"
          value={String(readyCount).padStart(2, '0')}
          detail="Сформовані та перевірені"
          tone="green"
          icon={<CheckCircle2 size={17} />}
        />
        <SummaryCard
          label="Чернетки"
          value={String(draftCount).padStart(2, '0')}
          detail="Потребують заповнення полів"
          tone="amber"
          icon={<Clock size={17} />}
        />
        <SummaryCard
          label="Потребують оновлення"
          value={String(outdatedCount).padStart(2, '0')}
          detail="Маршрут або дані застаріли"
          tone="blue"
          icon={<Route size={17} />}
        />
      </section>

      <section className="plan-grid">
        <div className="panel plan-list-panel">
          <div className="list-header">
            <div>
              <div className="section-title">
                Завдання <span className="list-count">{eodPlans.length}</span>
              </div>
              <span className="section-subtitle">Завдання, для яких формується CASEVAC-план</span>
            </div>
          </div>
          <div className="plan-list">
            {eodPlans.map((plan) => (
              <button
                key={plan.id}
                className={`plan-row ${selected?.id === plan.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(plan.id)}
              >
                <span className="plan-row-icon">
                  <ShieldAlert size={16} />
                </span>
                <span className="plan-row-main">
                  <strong>{plan.taskCode}</strong>
                  <span>
                    {plan.site} · {plan.region}
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
            <span>Джерело: шаблони EOD</span>
          </div>
        </div>

        {selected && (
          <div className="panel plan-detail-panel">
            <div className="panel-heading">
              <div>
                <div className="section-title">
                  <ShieldAlert size={17} />
                  {selected.taskCode}
                </div>
                <span className="section-subtitle">
                  {selected.site} · {selected.region}
                </span>
              </div>
              <span className={`status-badge ${statusClass(selected)}`}>
                <span />
                {planStatusLabel(selected.status)}
              </span>
            </div>

            <div className="plan-detail-body">
              <div className="info-grid">
                <div className="info-cell">
                  <span>МІСЦЕ ЗАВДАННЯ</span>
                  <strong>
                    <MapPin size={13} />
                    {selected.site}
                  </strong>
                </div>
                <div className="info-cell">
                  <span>ОБЛАСТЬ</span>
                  <strong>{selected.region}</strong>
                </div>
                <div className="info-cell">
                  <span>МЕДИЧНИЙ ЗАКЛАД</span>
                  <strong>
                    <Hospital size={13} />
                    {selected.facilityName}
                  </strong>
                </div>
                <div className="info-cell">
                  <span>МАРШРУТ</span>
                  <strong>
                    <Route size={13} />
                    {selected.routeCode}
                  </strong>
                </div>
              </div>

              <div>
                <span className="detail-label">ШАБЛОН ДОКУМЕНТА</span>
                <div className="doc-list">
                  <button
                    className="doc-row"
                    onClick={() =>
                      notify(
                        `Шаблон «${selected.template}» буде завантажено з Portal після входу (FR-33).`,
                        'info',
                      )
                    }
                  >
                    <span className="doc-icon plan">
                      <FileText size={15} />
                    </span>
                    <span className="doc-copy">
                      <strong>{selected.template}</strong>
                      <span>Еталон EOD · DOCX/PDF · захищене сховище Portal</span>
                    </span>
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>

              <div>
                <span className="detail-label">СТАН ПІДГОТОВКИ</span>
                <div className="checklist">
                  <div className={`checklist-row ${selected.status === 'outdated' ? 'pending' : ''}`}>
                    {selected.status === 'outdated' ? <Clock size={15} /> : <CheckCircle2 size={15} />}
                    <span>Маршрут і початкова точка</span>
                    <span>{selected.status === 'outdated' ? 'Потрібне обстеження' : 'Актуальні'}</span>
                  </div>
                  <div className={`checklist-row ${selected.status === 'draft' ? 'pending' : ''}`}>
                    {selected.status === 'draft' ? <Clock size={15} /> : <CheckCircle2 size={15} />}
                    <span>Атрибути маршруту</span>
                    <span>{selected.status === 'draft' ? 'Не заповнено surveyed_by' : 'Заповнені'}</span>
                  </div>
                  <div className={`checklist-row ${selected.status === 'actual' ? '' : 'pending'}`}>
                    {selected.status === 'actual' ? <CheckCircle2 size={15} /> : <Clock size={15} />}
                    <span>Документ плану</span>
                    <span>{selected.status === 'actual' ? 'Сформовано' : 'Ще не сформовано'}</span>
                  </div>
                </div>
              </div>

              <div className="plan-note-line">
                <Clock size={14} />
                <span>{selected.note}</span>
              </div>
            </div>

            <div className="plan-actions">
              <button
                className="button button-primary"
                onClick={() =>
                  notify('Генерація CASEVAC-плану EOD — етап 6: шаблонізація DOCX і вставка карти.', 'info')
                }
              >
                <FileText size={16} />
                Сформувати CASEVAC-план
              </button>
              <button
                className="button button-secondary"
                onClick={() =>
                  notify('Перехід до маршруту з’явиться після зв’язування планів із шаром маршрутів.', 'info')
                }
              >
                <Route size={16} />
                Відкрити маршрут
              </button>
            </div>

            <div className="plan-hint">
              <ShieldAlert size={15} />
              <span>
                Перелік завдань EOD у прототипі демонстраційний. Джерело даних і правила формування документів
                будуть уточнені разом із шаблонами замовника.
              </span>
            </div>
          </div>
        )}
      </section>

      <PageFooter note="Плани реагування CDS (EOD)" />
    </div>
  );
}
