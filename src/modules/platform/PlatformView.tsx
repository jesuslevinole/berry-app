import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useToday } from '../../hooks/useToday';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { useDataTableColumns } from '../../hooks/useColumnVisibility';
import { Toolbar } from '../../components/ui/Toolbar';
import { ViewTabs, type ViewTab } from '../../components/ui/ViewTabs';
import {
  accessEndsOf,
  billingInfoOf,
  EXPIRING_SOON_DAYS,
  subscriptionGroupOf,
  type BillingInfo,
  type SubscriptionGroup,
} from '../../services/billingService';
import { approveCompany, setCompanyExempt, setCompanySuspended } from '../../services/companyAdminService';
import { fmtDate, fmtMoney } from '../../utils/format';
import { COLLECTIONS, type Company, type SystemUser } from '../../types/models';
import { RecordPaymentModal } from './RecordPaymentModal';
import { PurgeCompanyModal } from './PurgeCompanyModal';
import './PlatformView.css';

type PanelTab = SubscriptionGroup | 'all';

interface CompanyRow {
  id: string;
  company: Company;
  group: SubscriptionGroup;
  billing: BillingInfo;
  accessEnds: string;
  users: number;
}

const GROUP_LABELS: Record<SubscriptionGroup, string> = {
  active: 'Active',
  expiring: 'Expiring soon',
  expired: 'Expired',
  purgeDue: 'Data deletion due',
  pending: 'Pending approval',
  suspended: 'Suspended',
  exempt: 'No payment required',
  noPlan: 'No plan',
};

/** Orden de las pestanas: primero lo que pide accion. */
const TAB_ORDER: SubscriptionGroup[] = ['purgeDue', 'expiring', 'expired', 'pending', 'active', 'suspended', 'noPlan', 'exempt'];

/** Tarjetas de arriba: los estados que pidio el dueno de la plataforma. */
const KPI_GROUPS: SubscriptionGroup[] = ['active', 'expiring', 'expired', 'pending', 'exempt'];

/** Lo mas urgente arriba: menos dias de acceso primero; sin fecha al final. */
const byUrgency = (a: CompanyRow, b: CompanyRow): number =>
  (a.billing.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.billing.daysLeft ?? Number.MAX_SAFE_INTEGER) ||
  a.company.name.localeCompare(b.company.name);

/** Detalle bajo el estado; la pendiente aun no tiene plan, espera la aprobacion. */
const stateDetail = (row: CompanyRow): string => (row.group === 'pending' ? 'Waiting for approval' : row.billing.label);

const daysLeftLabel = (row: CompanyRow): string => {
  const { daysLeft } = row.billing;
  if (daysLeft === null) return '—';
  if (daysLeft < 0) return `${Math.abs(daysLeft)} days ago`;
  return daysLeft === 1 ? '1 day' : `${daysLeft} days`;
};

interface PlatformKpisProps {
  counts: Record<SubscriptionGroup, number>;
  onSelect: (group: SubscriptionGroup) => void;
}

/** Contadores por estado; cada tarjeta filtra la tabla. */
const PlatformKpis = ({ counts, onSelect }: PlatformKpisProps) => (
  <div className="platform__kpis">
    {KPI_GROUPS.map((group) => (
      <button key={group} type="button" className={`platform__kpi platform__kpi--${group}`} onClick={() => onSelect(group)}>
        <span className="platform__kpi-label">{GROUP_LABELS[group]}</span>
        <strong className="platform__kpi-count">{counts[group]}</strong>
        {group === 'expiring' && <span className="platform__kpi-hint">Next {EXPIRING_SOON_DAYS} days</span>}
      </button>
    ))}
  </div>
);

interface CompanyActionsProps {
  row: CompanyRow;
  busy: boolean;
  onApprove: (company: Company) => void;
  onRecordPayment: (company: Company) => void;
  onToggleSuspended: (company: Company) => void;
  onToggleFreeAccess: (company: Company) => void;
  onPurge: (company: Company) => void;
}

const CompanyActions = ({
  row,
  busy,
  onApprove,
  onRecordPayment,
  onToggleSuspended,
  onToggleFreeAccess,
  onPurge,
}: CompanyActionsProps) => {
  const { company, group } = row;
  const canPay = group !== 'pending' && group !== 'exempt';
  /* "No payment required" nunca se bloquea (billingInfoOf la revisa primero): suspenderla no haria nada. */
  const canSuspend = group !== 'pending' && group !== 'exempt';
  const canToggleFree = group !== 'pending' && group !== 'suspended';
  return (
    <span className="platform__actions">
      {group === 'pending' && (
        <button type="button" className="btn btn--primary platform__action" disabled={busy} onClick={() => onApprove(company)}>
          Approve
        </button>
      )}
      {canPay && (
        <button type="button" className="btn btn--primary platform__action" disabled={busy} onClick={() => onRecordPayment(company)}>
          Record payment
        </button>
      )}
      {canSuspend && (
        <button type="button" className="btn btn--secondary platform__action" disabled={busy} onClick={() => onToggleSuspended(company)}>
          {company.status === 'Suspended' ? 'Reactivate' : 'Suspend'}
        </button>
      )}
      {group === 'purgeDue' && (
        <button type="button" className="btn btn--danger platform__action" disabled={busy} onClick={() => onPurge(company)}>
          Delete data
        </button>
      )}
      {canToggleFree && (
        <button type="button" className="btn btn--secondary platform__action" disabled={busy} onClick={() => onToggleFreeAccess(company)}>
          {company.exempt ? 'Require payment' : 'No payment required'}
        </button>
      )}
    </span>
  );
};

/**
 * Panel Admin de la plataforma: todas las empresas con su suscripcion (activas,
 * por vencer, vencidas, pendientes). El bloqueo al vencer lo hace App.tsx con
 * billingInfoOf; aqui se registran pagos, se aprueba y se suspende.
 */
export const PlatformView = () => {
  const { isPlatformAdmin } = useAuth();
  const today = useToday();
  const { data: companies, loading } = useCollection<Company>(COLLECTIONS.COMPANIES);
  const { data: users } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  const [tab, setTab] = useState<PanelTab>('all');
  const [search, setSearch] = useState('');
  const [payingCompany, setPayingCompany] = useState<Company | null>(null);
  const [purgingCompany, setPurgingCompany] = useState<Company | null>(null);
  const [busyId, setBusyId] = useState('');

  /* Se recalcula al cambiar el dia (today): lo que vence hoy pasa solo a "Expired". */
  const rows = useMemo<CompanyRow[]>(() => {
    const usersPerCompany = new Map<string, number>();
    for (const user of users) {
      if (user.companyId) usersPerCompany.set(user.companyId, (usersPerCompany.get(user.companyId) ?? 0) + 1);
    }
    return companies.map((company) => ({
      id: company.id,
      company,
      group: subscriptionGroupOf(company),
      billing: billingInfoOf(company),
      accessEnds: accessEndsOf(company),
      users: usersPerCompany.get(company.id) ?? 0,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- today fuerza el recalculo diario
  }, [companies, users, today]);

  const counts = useMemo(() => {
    const result = Object.fromEntries(TAB_ORDER.map((group) => [group, 0])) as Record<SubscriptionGroup, number>;
    for (const row of rows) result[row.group] += 1;
    return result;
  }, [rows]);

  const searchTerm = search.trim().toLowerCase();
  const visibleRows = rows
    .filter((row) => tab === 'all' || row.group === tab)
    .filter((row) => !searchTerm || [row.company.name, row.company.code ?? '', row.company.billingEmail ?? ''].join(' ').toLowerCase().includes(searchTerm))
    .sort(byUrgency);

  const tabs: Array<ViewTab<PanelTab>> = [
    { id: 'all', label: 'All', count: rows.length },
    ...TAB_ORDER.filter((group) => counts[group] > 0 || KPI_GROUPS.includes(group)).map((group) => ({
      id: group,
      label: GROUP_LABELS[group],
      count: counts[group],
    })),
  ];

  const runAction = async (company: Company, action: () => Promise<void>, failure: string) => {
    setBusyId(company.id);
    try {
      await action();
    } catch {
      alert(failure);
    } finally {
      setBusyId('');
    }
  };

  const handleApprove = (company: Company) => {
    if (!window.confirm(`Approve "${company.name}"? It starts its free trial today.`)) return;
    void runAction(company, () => approveCompany(company, users), 'The company could not be approved. Try again.');
  };

  const handleToggleSuspended = (company: Company) => {
    const suspend = company.status !== 'Suspended';
    const question = suspend
      ? `Suspend "${company.name}"? Its users lose access right away.`
      : `Reactivate "${company.name}"? Access returns if its subscription is current.`;
    if (!window.confirm(question)) return;
    void runAction(company, () => setCompanySuspended(company, suspend), 'The company could not be updated. Try again.');
  };

  const handleToggleFreeAccess = (company: Company) => {
    const free = !company.exempt;
    const question = free
      ? `Mark "${company.name}" as No payment required? It keeps full access and is never blocked.`
      : `Require payment from "${company.name}" again? Access then depends on its trial or paid period.`;
    if (!window.confirm(question)) return;
    void runAction(company, () => setCompanyExempt(company, free), 'The company could not be updated. Try again.');
  };

  const columns: Array<Column<CompanyRow>> = [
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <CompanyActions
          row={row}
          busy={busyId === row.id}
          onApprove={handleApprove}
          onRecordPayment={setPayingCompany}
          onToggleSuspended={handleToggleSuspended}
          onToggleFreeAccess={handleToggleFreeAccess}
          onPurge={setPurgingCompany}
        />
      ),
    },
    {
      key: 'company',
      header: 'Company',
      render: (row) => (
        <span className="platform__company">
          <strong>{row.company.name}</strong>
          {row.company.billingEmail && <span className="platform__muted">{row.company.billingEmail}</span>}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'Subscription',
      render: (row) => (
        <span className="platform__state-cell">
          <span className={`platform__state platform__state--${row.group}`}>{GROUP_LABELS[row.group]}</span>
          <span className="platform__muted">{stateDetail(row)}</span>
        </span>
      ),
    },
    { key: 'accessEnds', header: 'Access until', render: (row) => fmtDate(row.accessEnds) || '—' },
    { key: 'daysLeft', header: 'Days left', align: 'right', render: daysLeftLabel },
    {
      key: 'lastPayment',
      header: 'Last payment',
      render: (row) =>
        row.company.lastPaymentAt ? `${fmtDate(row.company.lastPaymentAt)} · ${fmtMoney(row.company.lastPaymentAmount)}` : '—',
    },
    { key: 'users', header: 'Users', align: 'right', render: (row) => row.users },
  ];
  const { view: columnView, visibleColumns } = useDataTableColumns('platform-subscriptions', columns);

  if (!isPlatformAdmin) {
    return (
      <div className="platform">
        <Toolbar title="Subscriptions" subtitle="Platform administration" />
        <p className="platform__denied">Only platform administrators can see the Admin Panel.</p>
      </div>
    );
  }

  return (
    <div className="platform">
      <Toolbar
        title="Subscriptions"
        subtitle="Subscriptions of every company on the platform"
        searchValue={search}
        onSearchChange={setSearch}
      >
        <ColumnPicker view={columnView} />
      </Toolbar>

      <PlatformKpis counts={counts} onSelect={setTab} />

      <ViewTabs tabs={tabs} active={tab} onChange={setTab} />

      <DataTable
        columns={visibleColumns}
        rows={visibleRows}
        loading={loading}
        emptyMessage="No companies in this group."
      />

      <p className="platform__hint">
        Access ends automatically when the paid period (or free trial) runs out: the company sees
        &ldquo;Subscription inactive&rdquo; until a payment is recorded. Companies marked No payment required are
        never blocked.
      </p>

      {payingCompany && <RecordPaymentModal company={payingCompany} onClose={() => setPayingCompany(null)} />}
      {purgingCompany && (
        <PurgeCompanyModal company={purgingCompany} users={users} onClose={() => setPurgingCompany(null)} />
      )}
    </div>
  );
};
