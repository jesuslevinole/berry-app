import { useEffect, useMemo, useState } from 'react';
import { limit, orderBy } from 'firebase/firestore';
import { deleteFromTrashForever, restoreFromTrash, subscribeToCollection } from '../../services/firestore';
import { useAuth } from '../../context/AuthContext';
import { Toolbar } from '../../components/ui/Toolbar';
import { COLLECTIONS, type TrashItem } from '../../types/models';
import './TrashView.css';

const COLLECTION_LABELS: Record<string, string> = {
  [COLLECTIONS.PURCHASE_ORDER]: 'Purchase Orders',
  [COLLECTIONS.PURCHASE_DETAILS]: 'Purchase Order lines',
  [COLLECTIONS.SALES_ORDER]: 'Sales Desk',
  [COLLECTIONS.SALES_ORDER_DETAIL]: 'Sales Desk lines',
  [COLLECTIONS.EXPENSES]: 'Expenses',
  [COLLECTIONS.CHECKS]: 'Checkbook',
};

const fmtDateTime = (iso: string): string => {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Resumen legible del registro borrado (numero de orden, lote, nombre o id). */
const summarize = (item: TrashItem): string => {
  const data = item.DATA ?? {};
  const candidates = ['SALES_ORDER_NUMBER', 'LOT_NUMBER', 'CHECK_NUMBER', 'INVOICE_NUMBER', 'REF_NUMBER', 'REF'];
  for (const key of candidates) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('NAME') && typeof value === 'string' && value.trim()) return value;
  }
  return item.ORIGIN_ID;
};

export function TrashView() {
  const { can } = useAuth();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    const unsub = subscribeToCollection<TrashItem>(
      COLLECTIONS.TRASH,
      setItems,
      () => setItems([]),
      [orderBy('DELETED_AT', 'desc'), limit(300)],
    );
    return () => unsub();
  }, []);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        !term ||
        [COLLECTION_LABELS[item.ORIGIN_COLLECTION] ?? item.ORIGIN_COLLECTION, summarize(item), item.DELETED_BY]
          .join(' ')
          .toLowerCase()
          .includes(term),
    );
  }, [items, search]);

  const handleRestore = async (item: TrashItem) => {
    setBusyId(item.id);
    try {
      await restoreFromTrash(item.id);
    } catch {
      alert('Could not restore this record. Try again.');
    } finally {
      setBusyId('');
    }
  };

  const handleForever = async (item: TrashItem) => {
    if (!window.confirm('Delete this record forever? This cannot be undone.')) return;
    setBusyId(item.id);
    try {
      await deleteFromTrashForever(item.id);
    } catch {
      alert('Could not delete this record. Try again.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="trash">
      <Toolbar
        title="Recycle Bin"
        subtitle="Deleted records land here and can be restored"
        searchValue={search}
        onSearchChange={setSearch}
      />

      <div className="trash__chips">
        <span className="trash__chip">{rows.length} deleted records</span>
      </div>

      <div className="trash__card">
        <table className="trash__table">
          <thead>
            <tr>
              <th className="trash__th">Deleted</th>
              <th className="trash__th">Module</th>
              <th className="trash__th">Record</th>
              <th className="trash__th">Deleted by</th>
              <th className="trash__th trash__th--actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className="trash__empty" colSpan={5}>The recycle bin is empty.</td></tr>
            )}
            {rows.map((item) => (
              <tr key={item.id}>
                <td className="trash__td trash__td--muted">{fmtDateTime(item.DELETED_AT)}</td>
                <td className="trash__td trash__td--strong">{COLLECTION_LABELS[item.ORIGIN_COLLECTION] ?? item.ORIGIN_COLLECTION}</td>
                <td className="trash__td trash__td--mono">{summarize(item)}</td>
                <td className="trash__td">{item.DELETED_BY || '\u2014'}</td>
                <td className="trash__td trash__td--actions">
                  {can('trash', 'edit') && (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busyId === item.id}
                      onClick={() => void handleRestore(item)}
                    >
                      Restore
                    </button>
                  )}
                  {can('trash', 'delete') && (
                    <button
                      type="button"
                      className="btn btn--danger"
                      disabled={busyId === item.id}
                      onClick={() => void handleForever(item)}
                    >
                      Delete forever
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
