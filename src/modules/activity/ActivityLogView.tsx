import { useEffect, useMemo, useState } from 'react';
import { limit, orderBy } from 'firebase/firestore';
import { subscribeToCollection } from '../../services/firestore';
import { Toolbar } from '../../components/ui/Toolbar';
import { PAGE_SIZE } from '../../config/limits';
import { COLLECTIONS, type ActivityLog } from '../../types/models';
import { MODULE_DEFS } from '../../config/modules';
import './ActivityLogView.css';

/** Etiqueta legible por coleccion (cae al nombre crudo si no se conoce). */
const COLLECTION_LABELS: Record<string, string> = {
  [COLLECTIONS.PURCHASE_ORDER]: 'Purchase Orders',
  [COLLECTIONS.PURCHASE_DETAILS]: 'Purchase Order lines',
  [COLLECTIONS.SALES_ORDER]: 'Sales Desk',
  [COLLECTIONS.SALES_ORDER_DETAIL]: 'Sales Desk lines',
  [COLLECTIONS.EXPENSES]: 'Expenses',
  [COLLECTIONS.CHECKS]: 'Checkbook',
  [COLLECTIONS.SYSTEM_USERS]: 'System Users',
};

const ACTION_LABELS: Record<ActivityLog['ACTION'], string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  restore: 'Restored',
};

const fmtDateTime = (iso: string): string => {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const moduleLabel = (col: string): string =>
  COLLECTION_LABELS[col] ?? MODULE_DEFS.find((m) => m.id === col)?.label ?? col;

export function ActivityLogView() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  /* Historial en vivo, del mas reciente al mas antiguo (limite de seguridad 500, patron Roelca). */
  useEffect(() => {
    const unsub = subscribeToCollection<ActivityLog>(
      COLLECTIONS.ACTIVITY_LOG,
      setLogs,
      () => setLogs([]),
      [orderBy('DATE', 'desc'), limit(500)],
    );
    return () => unsub();
  }, []);

  const users = useMemo(() => [...new Set(logs.map((l) => l.USER_EMAIL))].sort(), [logs]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return logs
      .filter((l) => !userFilter || l.USER_EMAIL === userFilter)
      .filter((l) => !actionFilter || l.ACTION === actionFilter)
      .filter((l) => !dateFilter || (l.DATE ?? '').startsWith(dateFilter))
      .filter(
        (l) =>
          !term ||
          [l.USER_EMAIL, moduleLabel(l.COLLECTION), ACTION_LABELS[l.ACTION] ?? l.ACTION, l.DOC_ID, l.DETAIL ?? '']
            .join(' ')
            .toLowerCase()
            .includes(term),
      );
  }, [logs, search, userFilter, actionFilter, dateFilter]);

  /* Paginacion: hasta PAGE_SIZE filas visibles a la vez. */
  const [page, setPage] = useState(1);
  const pageCount = Math.max(Math.ceil(rows.length / PAGE_SIZE), 1);
  const visibleRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  return (
    <div className="activity">
      <Toolbar
        title="Activity Log"
        subtitle="Every create, update, delete and restore, in real time"
        searchValue={search}
        onSearchChange={setSearch}
      />

      <div className="activity__filters">
        <div className="activity__filter">
          <span className="activity__filter-label">User</span>
          <select className="input" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <div className="activity__filter">
          <span className="activity__filter-label">Action</span>
          <select className="input" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">All actions</option>
            <option value="create">Created</option>
            <option value="update">Updated</option>
            <option value="delete">Deleted</option>
            <option value="restore">Restored</option>
          </select>
        </div>
        <div className="activity__filter">
          <span className="activity__filter-label">Date</span>
          <input className="input" type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
        </div>
        <span className="activity__count">{rows.length} records (last 500)</span>
      </div>

      <div className="activity__card">
        <table className="activity__table">
          <thead>
            <tr>
              <th className="activity__th">Date</th>
              <th className="activity__th">User</th>
              <th className="activity__th">Module</th>
              <th className="activity__th">Action</th>
              <th className="activity__th">Record</th>
              <th className="activity__th">Detail</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr><td className="activity__empty" colSpan={6}>No activity matches the current filters.</td></tr>
            )}
            {visibleRows.map((log) => (
              <tr key={log.id}>
                <td className="activity__td activity__td--muted">{fmtDateTime(log.DATE)}</td>
                <td className="activity__td">{log.USER_EMAIL}</td>
                <td className="activity__td activity__td--strong">{moduleLabel(log.COLLECTION)}</td>
                <td className="activity__td">
                  <span className={`activity__badge activity__badge--${log.ACTION}`}>{ACTION_LABELS[log.ACTION] ?? log.ACTION}</span>
                </td>
                <td className="activity__td activity__td--mono">{log.DOC_ID}</td>
                <td className="activity__td activity__td--muted">{log.DETAIL || '\u2014'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > PAGE_SIZE && (
        <div className="activity__pager">
          <span className="activity__pager-info">
            Showing <b>{(page - 1) * PAGE_SIZE + 1}\u2013{Math.min(page * PAGE_SIZE, rows.length)}</b> of <b>{rows.length}</b>
          </span>
          <span className="activity__pager-actions">
            <button type="button" className="btn btn--secondary" disabled={page === 1} onClick={() => setPage((p) => Math.max(p - 1, 1))}>
              Previous
            </button>
            <span className="activity__pager-page">Page {page} of {pageCount}</span>
            <button type="button" className="btn btn--secondary" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(p + 1, pageCount))}>
              Next
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
