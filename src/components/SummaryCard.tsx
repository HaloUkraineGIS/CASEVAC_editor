import type { ReactNode } from 'react';

export type SummaryTone = 'neutral' | 'green' | 'blue' | 'amber' | 'teal';

interface SummaryCardProps {
  label: string;
  value: string;
  detail: string;
  tone: SummaryTone;
  icon: ReactNode;
  /** Якщо задано, картка стає кнопкою-фільтром. */
  onClick?: () => void;
  /** Картка позначає активний фільтр. */
  active?: boolean;
}

function SummaryCardBody({
  label,
  value,
  detail,
  tone,
  icon,
}: Omit<SummaryCardProps, 'onClick' | 'active'>) {
  return (
    <>
      <div className="summary-card-top">
        <span>{label}</span>
        <span className={`summary-icon ${tone}`}>{icon}</span>
      </div>
      <div className="summary-card-value">{value}</div>
      <div className="summary-card-detail">
        <span className={`summary-detail-dot ${tone}`} />
        {detail}
      </div>
    </>
  );
}

export function SummaryCard({
  label,
  value,
  detail,
  tone,
  icon,
  onClick,
  active = false,
}: SummaryCardProps) {
  const body = { label, value, detail, tone, icon };

  if (!onClick) {
    return (
      <article className="summary-card">
        <SummaryCardBody {...body} />
      </article>
    );
  }

  return (
    <button
      type="button"
      className={`summary-card summary-card-button ${active ? 'is-active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
      title={active ? `${label}: фільтр увімкнено — натисніть, щоб скинути` : `${label}: показати у списку`}
    >
      <SummaryCardBody {...body} />
    </button>
  );
}
