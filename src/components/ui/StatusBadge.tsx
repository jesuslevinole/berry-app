import './StatusBadge.css';

const TONE_BY_STATUS: Record<string, string> = {
  Draft: 'warn',
  'Pending Load': 'warn',
  Loaded: 'info',
  Delivered: 'ok',
  Paid: 'ok',
  Cancelled: 'bad',
  Yes: 'ok',
  No: 'bad',
};

interface StatusBadgeProps {
  value: string;
  tone?: 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
}

export function StatusBadge({ value, tone }: StatusBadgeProps) {
  const resolved = tone ?? TONE_BY_STATUS[value] ?? 'neutral';
  return <span className={`status-badge status-badge--${resolved}`}>{value}</span>;
}
