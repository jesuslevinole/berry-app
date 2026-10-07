import { useEffect, useMemo, useState } from 'react';
import { limit, orderBy, where } from 'firebase/firestore';
import { getDocumentsById, listDocuments, subscribeToCollection } from '../../services/firestore';
import { moduleLabel, recordLabel } from '../../services/recordLabels';
import { useCollection } from '../../hooks/useCollection';
import { Toolbar } from '../../components/ui/Toolbar';
import { PAGE_SIZE } from '../../config/limits';
import { COLLECTIONS, type ActivityLog, type BaseDoc, type SystemUser, type TrashItem } from '../../types/models';
import './ActivityLogView.css';

/** Maximo de registros por consulta (control de lecturas). */
const MAX_ROWS = 1000;
const ALL_USERS = '__all__';

const ACTION_LABELS: Record<ActivityLog['ACTION'], string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  restore: 'Restored',
};

const fmtDateTime = (iso: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** yyyy-mm-dd (hora local) -> instante ISO del inicio de ese dia. */
const startOfDayIso = (day: string): string => new Date(`${day}T00:00:00`).toISOString();
const nextDayIso = (day: string): string => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
};

type Doc = BaseDoc & Record<string, unknown>;
const cacheKey = (col: string, id: string): string => `${col}/${id}`;

/**
 * Nombres de los registros sin LABEL (historial anterior): se leen solo los de la
 * pagina visible. Si el registro ya no existe se busca en la papelera.
 */
async function resolveLabels(rows: ActivityLog[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byCol = new Map<string, string[]>();
  for (const r of rows) byCol.set(r.COLLECTION, [...(byCol.get(r.COLLECTION) ?? []), r.DOC_ID]);

  const found = new Map<string, Record<string, unknown>>();
  await Promise.all(
    [...byCol].map(async ([col, ids]) => {
      const docs = await getDocumentsById<Doc>(col, ids).catch(() => new Map<string, Doc>());
      for (const [id, d] of docs) found.set(cacheKey(col, id), d);
    }),
  );

  /* Borrados: sus datos quedaron en la papelera. */
  const missing = rows.filter((r) => !found.has(cacheKey(r.COLLECTION, r.DOC_ID))).map((r) => r.DOC_ID);
  const uniqueMissing = [...new Set(missing)];
  for (let i = 0; i < uniqueMissing.length; i += 30) {
    const chunk = uniqueMissing.slice(i, i + 30);
    const trash = await listDocuments<TrashItem>(COLLECTIONS.TRASH, [where('ORIGIN_ID', 'in', chunk)]).catch(() => []);
    for (const t of trash) found.set(cacheKey(t.ORIGIN_COLLECTION, t.ORIGIN_ID), t.DATA ?? {});
  }

  /* Lineas: se antepone el numero de su orden / lote. */
  const soIds: string[] = [];
  const poIds: string[] = [];
  for (const [key, data] of found) {
    if (key.startsWith(`${COLLECTIONS.SALES_ORDER_DETAIL}/`)) soIds.push(String(data.ID_SALESORDER ?? ''));
    if (key.startsWith(`${COLLECTIONS.PURCHASE_DETAILS}/`)) poIds.push(String(data.ID_PURCHASEORDER ?? ''));
  }
  const [orders, lots] = await Promise.all([
    soIds.length ? getDocumentsById<Doc>(COLLECTIONS.SALES_ORDER, soIds).catch(() => new Map<string, Doc>()) : new Map<string, Doc>(),
    poIds.length ? getDocumentsById<Doc>(COLLECTIONS.PURCHASE_ORDER, poIds).catch(() => new Map<string, Doc>()) : new Map<string, Doc>(),
  ]);

  for (const [key, data] of found) {
    const col = key.slice(0, key.indexOf('/'));
    let label = recordLabel(col, data);
    if (col === COLLECTIONS.SALES_ORDER_DETAIL) {
      const so = orders.get(String(data.ID_SALESORDER ?? ''));
      if (so?.SALES_ORDER_NUMBER) label = [`SO ${String(so.SALES_ORDER_NUMBER)}`, label].filter(Boolean).join(' · ');
    }
    if (col === COLLECTIONS.PURCHASE_DETAILS) {
      const po = lots.get(String(data.ID_PURCHASEORDER ?? ''));
      if (po?.LOT_NUMBER) label = [`Lot ${String(po.LOT_NUMBER)}`, label].filter(Boolean).join(' · ');
    }
    out.set(key, label);
  }
  return out;
}

export function ActivityLogView() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  /* Rango cuyas filas ya llegaron (si no coincide con el actual, esta cargando). */
  const [loadedRange, setLoadedRange] = useState('');
  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  /* Nombres ya resueltos de registros viejos (sin LABEL). */
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  const users = useMemo(
    () => [...new Set(systemUsers.map((u) => (u.email ?? '').trim()).filter(Boolean))].sort(),
    [systemUsers],
  );

  /* No se muestra (ni se lee) nada hasta completar fechas y usuario. */
  const datesReady = !!fromDate && !!toDate && fromDate <= toDate;
  const ready = datesReady && !!userFilter;

  const range = `${fromDate}|${toDate}`;
  const loading = loadedRange !== range;
  useEffect(() => {
    if (!datesReady) return;
    const unsub = subscribeToCollection<ActivityLog>(
      COLLECTIONS.ACTIVITY_LOG,
      (rows) => {
        setLogs(rows);
        setLoadedRange(`${fromDate}|${toDate}`);
      },
      () => {
        setLogs([]);
        setLoadedRange(`${fromDate}|${toDate}`);
      },
      [where('DATE', '>=', startOfDayIso(fromDate)), where('DATE', '<', nextDayIso(toDate)), orderBy('DATE', 'desc'), limit(MAX_ROWS)],
    );
    return () => unsub();
  }, [datesReady, fromDate, toDate]);

  const labelOf = (log: ActivityLog): string => log.LABEL || labels.get(cacheKey(log.COLLECTION, log.DOC_ID)) || '';

  const rows = useMemo(() => {
    if (!ready || loading) return [];
    const term = search.trim().toLowerCase();
    return logs
      .filter((l) => userFilter === ALL_USERS || (l.USER_EMAIL ?? '').toLowerCase() === userFilter.toLowerCase())
      .filter((l) => !actionFilter || l.ACTION === actionFilter)
      .filter(
        (l) =>
          !term ||
          [l.USER_EMAIL, moduleLabel(l.COLLECTION), ACTION_LABELS[l.ACTION] ?? l.ACTION, l.LABEL ?? '', labels.get(cacheKey(l.COLLECTION, l.DOC_ID)) ?? '', l.DETAIL ?? '']
            .join(' ')
            .toLowerCase()
            .includes(term),
      );
  }, [ready, loading, logs, search, userFilter, actionFilter, labels]);

  /* Paginacion: hasta PAGE_SIZE filas visibles a la vez. */
  const [page, setPage] = useState(1);
  const pageCount = Math.max(Math.ceil(rows.length / PAGE_SIZE), 1);
  const safePage = Math.min(page, pageCount);
  const visibleRows = useMemo(() => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [rows, safePage]);

  /* Nombres de la pagina visible que no traen LABEL. */
  useEffect(() => {
    const pending = visibleRows.filter((r) => !r.LABEL && !labels.has(cacheKey(r.COLLECTION, r.DOC_ID)));
    if (pending.length === 0) return;
    let cancelled = false;
    void resolveLabels(pending).then((resolved) => {
      if (cancelled) return;
      setLabels((prev) => {
        const next = new Map(prev);
        for (const r of pending) next.set(cacheKey(r.COLLECTION, r.DOC_ID), resolved.get(cacheKey(r.COLLECTION, r.DOC_ID)) ?? '');
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [visibleRows, labels]);

  const resetPage = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="activity">
      <Toolbar
        title="Activity Log"
        subtitle="Every create, update, delete and restore, in real time"
        searchValue={search}
        onSearchChange={resetPage(setSearch)}
      />

      <div className="activity__filters">
        <div className="activity__filter">
          <span className="activity__filter-label">User *</span>
          <select className="input" value={userFilter} onChange={(e) => resetPage(setUserFilter)(e.target.value)}>
            <option value="">Select a user…</option>
            <option value={ALL_USERS}>All users</option>
            {users.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <div className="activity__filter">
          <span className="activity__filter-label">From *</span>
          <input className="input" type="date" value={fromDate} onChange={(e) => resetPage(setFromDate)(e.target.value)} />
        </div>
        <div className="activity__filter">
          <span className="activity__filter-label">To *</span>
          <input className="input" type="date" value={toDate} min={fromDate || undefined} onChange={(e) => resetPage(setToDate)(e.target.value)} />
        </div>
        <div className="activity__filter">
          <span className="activity__filter-label">Action</span>
          <select className="input" value={actionFilter} onChange={(e) => resetPage(setActionFilter)(e.target.value)}>
            <option value="">All actions</option>
            <option value="create">Created</option>
            <option value="update">Updated</option>
            <option value="delete">Deleted</option>
            <option value="restore">Restored</option>
          </select>
        </div>
        {ready && (
          <span className="activity__count">
            {rows.length} records{logs.length >= MAX_ROWS ? ` (first ${MAX_ROWS} in the range)` : ''}
          </span>
        )}
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
            {!ready && (
              <tr>
                <td className="activity__empty" colSpan={6}>
                  {fromDate && toDate && fromDate > toDate
                    ? 'The “From” date must be before the “To” date.'
                    : 'Choose the user and the date range (From and To) to see the activity.'}
                </td>
              </tr>
            )}
            {ready && loading && (
              <tr><td className="activity__empty" colSpan={6}>Loading…</td></tr>
            )}
            {ready && !loading && visibleRows.length === 0 && (
              <tr><td className="activity__empty" colSpan={6}>No activity matches the current filters.</td></tr>
            )}
            {visibleRows.map((log) => {
              const label = labelOf(log);
              const resolving = !log.LABEL && !labels.has(cacheKey(log.COLLECTION, log.DOC_ID));
              return (
                <tr key={log.id}>
                  <td className="activity__td activity__td--muted">{fmtDateTime(log.DATE)}</td>
                  <td className="activity__td">{log.USER_EMAIL}</td>
                  <td className="activity__td activity__td--strong">{moduleLabel(log.COLLECTION)}</td>
                  <td className="activity__td">
                    <span className={`activity__badge activity__badge--${log.ACTION}`}>{ACTION_LABELS[log.ACTION] ?? log.ACTION}</span>
                  </td>
                  <td className="activity__td" title={`Record id: ${log.DOC_ID}`}>
                    {label || <span className="activity__td--muted">{resolving ? '…' : '(no name)'}</span>}
                  </td>
                  <td className="activity__td activity__td--muted">{log.DETAIL || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length > PAGE_SIZE && (
        <div className="activity__pager">
          <span className="activity__pager-info">
            Showing <b>{(safePage - 1) * PAGE_SIZE + 1}{'–'}{Math.min(safePage * PAGE_SIZE, rows.length)}</b> of <b>{rows.length}</b>
          </span>
          <span className="activity__pager-actions">
            <button type="button" className="btn btn--secondary" disabled={safePage === 1} onClick={() => setPage(Math.max(safePage - 1, 1))}>
              Previous
            </button>
            <span className="activity__pager-page">Page {safePage} of {pageCount}</span>
            <button type="button" className="btn btn--secondary" disabled={safePage >= pageCount} onClick={() => setPage(Math.min(safePage + 1, pageCount))}>
              Next
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
