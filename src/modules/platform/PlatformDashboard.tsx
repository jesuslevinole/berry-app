import { useMemo, useState } from 'react';
import { useCollection } from '../../hooks/useCollection';
import { useToday } from '../../hooks/useToday';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Toolbar } from '../../components/ui/Toolbar';
import { ViewTabs, type ViewTab } from '../../components/ui/ViewTabs';
import { billingInfoOf, subscriptionGroupOf } from '../../services/billingService';
import { estimatedMrr, monthlyRevenue, revenueByCompany, sortByNewest, type MonthRevenue } from '../../services/revenueService';
import { fmtDate, fmtMoney, fmtMoneyCompact } from '../../utils/format';
import { COLLECTIONS, type Company, type PlatformPayment } from '../../types/models';
import { RevenueByCompanyChart } from './RevenueByCompanyChart';
import { RevenueMonthlyChart } from './RevenueMonthlyChart';
import './PlatformDashboard.css';

type MonthlyView = 'chart' | 'table';

const MONTHLY_VIEWS: Array<ViewTab<MonthlyView>> = [
  { id: 'chart', label: 'Chart' },
  { id: 'table', label: 'Table' },
];

const MONTHS_SHOWN = 12;
const RECENT_PAYMENTS = 10;

/** Variacion contra el mes anterior; null si el mes anterior fue cero (no hay base). */
const changeVs = (current: number, previous: number): number | null =>
  previous > 0 ? (current - previous) / previous : null;

interface RevenueDeltaProps {
  change: number | null;
  previousLabel: string;
}

/** Subir es bueno: flecha y color por direccion, siempre con texto (no solo color). */
const RevenueDelta = ({ change, previousLabel }: RevenueDeltaProps) => {
  if (change === null) return <span className="platform-dash__delta">No revenue in {previousLabel} to compare</span>;
  const direction = change >= 0 ? 'up' : 'down';
  const arrow = change >= 0 ? '▲' : '▼';
  return (
    <span className={`platform-dash__delta platform-dash__delta--${direction}`}>
      {arrow} {Math.abs(change * 100).toFixed(0)}% vs {previousLabel}
    </span>
  );
};

interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
}

const StatTile = ({ label, value, hint, onClick }: StatTileProps) => (
  <button type="button" className="platform-dash__tile" disabled={!onClick} onClick={onClick}>
    <span className="platform-dash__tile-label">{label}</span>
    <strong className="platform-dash__tile-value">{value}</strong>
    {hint && <span className="platform-dash__tile-hint">{hint}</span>}
  </button>
);

interface MonthlyTableProps {
  months: MonthRevenue[];
}

/** Misma informacion que la grafica, en tabla (accesible y para copiar). */
const MonthlyTable = ({ months }: MonthlyTableProps) => (
  <table className="platform-dash__table">
    <thead>
      <tr>
        <th className="platform-dash__th">Month</th>
        <th className="platform-dash__th platform-dash__th--num">Payments</th>
        <th className="platform-dash__th platform-dash__th--num">Revenue</th>
      </tr>
    </thead>
    <tbody>
      {[...months].reverse().map((month) => (
        <tr key={month.key}>
          <td className="platform-dash__td">{month.longLabel}</td>
          <td className="platform-dash__td platform-dash__td--num">{month.payments}</td>
          <td className="platform-dash__td platform-dash__td--num">{fmtMoney(month.amount)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const PAYMENT_COLUMNS: Array<Column<PlatformPayment>> = [
  { key: 'paidOn', header: 'Paid on', render: (payment) => fmtDate(payment.paidOn) },
  { key: 'company', header: 'Company', render: (payment) => payment.companyName },
  { key: 'amount', header: 'Amount', align: 'right', render: (payment) => fmtMoney(payment.amount) },
  { key: 'periods', header: 'Months', align: 'right', render: (payment) => payment.periods },
  { key: 'paidThrough', header: 'Access until', render: (payment) => fmtDate(payment.paidThrough) },
  { key: 'recordedBy', header: 'Recorded by', render: (payment) => payment.recordedBy || '—' },
];

interface PlatformDashboardProps {
  /** Abre Subscriptions (desde las tarjetas que piden accion). */
  onOpenSubscriptions: () => void;
}

/**
 * Dashboard de ingresos de la plataforma: lo cobrado por mes y por empresa, el MRR
 * estimado y los ultimos pagos. Sale del historial platform_payments, que se llena
 * con "Record payment" (y mas adelante con Stripe).
 */
export const PlatformDashboard = ({ onOpenSubscriptions }: PlatformDashboardProps) => {
  const today = useToday();
  const { data: companies } = useCollection<Company>(COLLECTIONS.COMPANIES);
  const { data: payments, loading } = useCollection<PlatformPayment>(COLLECTIONS.PLATFORM_PAYMENTS);
  const [monthlyView, setMonthlyView] = useState<MonthlyView>('chart');

  const months = useMemo(() => monthlyRevenue(payments, today, MONTHS_SHOWN), [payments, today]);
  const byCompany = useMemo(
    () => revenueByCompany(payments, companies, months[0]?.key ?? ''),
    [payments, companies, months],
  );
  /* today fuerza el recalculo diario: un periodo pagado que vence deja de sumar al MRR. */
  const mrr = useMemo(
    () => estimatedMrr(companies, payments),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companies, payments, today],
  );
  const groupCounts = useMemo(() => {
    const counts = { paying: 0, free: 0, attention: 0 };
    for (const company of companies) {
      const group = subscriptionGroupOf(company);
      if (group === 'exempt') counts.free += 1;
      if (group === 'expiring' || group === 'expired') counts.attention += 1;
      if (billingInfoOf(company).state === 'Paid') counts.paying += 1;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, today]);

  const currentMonth = months.at(-1);
  const previousMonth = months.at(-2);
  const yearTotal = months.reduce((sum, month) => sum + month.amount, 0);
  const recentPayments = sortByNewest(payments).slice(0, RECENT_PAYMENTS);
  const hasPayments = payments.length > 0;

  return (
    <div className="platform-dash">
      <Toolbar title="Dashboard" subtitle="Revenue from subscriptions across every company" />

      <section className="platform-dash__hero">
        <span className="platform-dash__hero-label">Revenue this month</span>
        <strong className="platform-dash__hero-value">{fmtMoney(currentMonth?.amount)}</strong>
        <RevenueDelta
          change={changeVs(currentMonth?.amount ?? 0, previousMonth?.amount ?? 0)}
          previousLabel={previousMonth?.longLabel ?? 'last month'}
        />
      </section>

      <div className="platform-dash__tiles">
        <StatTile label="Last 12 months" value={fmtMoneyCompact(yearTotal)} hint={fmtMoney(yearTotal)} />
        <StatTile label="Estimated MRR" value={fmtMoney(mrr)} hint="Monthly value of current paid plans" />
        <StatTile label="Paying companies" value={String(groupCounts.paying)} />
        <StatTile label="No payment required" value={String(groupCounts.free)} hint="Free access" />
        <StatTile
          label="Need attention"
          value={String(groupCounts.attention)}
          hint="Expiring soon or expired"
          onClick={onOpenSubscriptions}
        />
      </div>

      {!loading && !hasPayments && (
        <p className="platform-dash__empty">
          No payments recorded yet. Every payment saved with <b>Record payment</b> in Subscriptions appears here.
        </p>
      )}

      <section className="platform-dash__card">
        <div className="platform-dash__card-head">
          <h3 className="platform-dash__card-title">Monthly revenue</h3>
          <ViewTabs tabs={MONTHLY_VIEWS} active={monthlyView} onChange={setMonthlyView} />
        </div>
        {monthlyView === 'chart' && <RevenueMonthlyChart months={months} />}
        {monthlyView === 'table' && <MonthlyTable months={months} />}
      </section>

      <div className="platform-dash__columns">
        <section className="platform-dash__card">
          <h3 className="platform-dash__card-title">Revenue by company · last 12 months</h3>
          {byCompany.length > 0 && <RevenueByCompanyChart rows={byCompany} />}
          {byCompany.length === 0 && <p className="platform-dash__muted">No revenue in the last 12 months.</p>}
        </section>

        <section className="platform-dash__card">
          <h3 className="platform-dash__card-title">Recent payments</h3>
          <DataTable
            columns={PAYMENT_COLUMNS}
            rows={recentPayments}
            loading={loading}
            emptyMessage="No payments recorded yet."
          />
        </section>
      </div>
    </div>
  );
};
