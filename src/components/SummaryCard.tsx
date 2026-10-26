import type { ReactNode } from 'react';

export function SummaryCard({
  label,
  value,
  detail,
  tone,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  tone: 'neutral' | 'green' | 'blue' | 'amber';
  icon: ReactNode;
}) {
  return (
    <article className="summary-card">
      <div className="summary-card-top">
        <span>{label}</span>
        <span className={`summary-icon ${tone}`}>{icon}</span>
      </div>
      <div className="summary-card-value">{value}</div>
      <div className="summary-card-detail">
        <span className={`summary-detail-dot ${tone}`} />
        {detail}
      </div>
    </article>
  );
}
