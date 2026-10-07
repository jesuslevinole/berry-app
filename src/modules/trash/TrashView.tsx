import { useEffect, useMemo, useState } from 'react';
import { limit, orderBy } from 'firebase/firestore';
import { deleteFromTrashForever, emptyTrash, restoreFromTrash, subscribeToCollection } from '../../services/firestore';
import { moduleLabel, recordLabel } from '../../services/recordLabels';
import { useAuth } from '../../context/AuthContext';
import { Toolbar } from '../../components/ui/Toolbar';
import { PAGE_SIZE } from '../../config/limits';
import { COLLECTIONS, type TrashItem } from '../../types/models';
import './TrashView.css';

const fmtDateTime = (iso: string): string => {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Resumen legible del registro borrado (numero de orden, lote, nombre o id). */
const summarize = (item: TrashItem): string => recordLabel(item.ORIGIN_COLLECTION, item.DATA) || item.ORIGIN_ID;

export function TrashView() {
  const { can } = useAuth();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');
  /* Vaciado completo en curso (cuantos lleva borrados). */
  const [emptying, setEmptying] = useState<number | null>(null);

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
        [moduleLabel(item.ORIGIN_COLLECTION), summarize(item), item.DELETED_BY]
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

  /** Borra definitivamente TODO lo que esta en la papelera. */
  const handleEmpty = async () => {
    if (!window.confirm('Delete EVERYTHING in the recycle bin forever? These records can no longer be restored.')) return;
    setEmptying(0);
    try {
      const total = await emptyTrash((done) => setEmptying(done));
      alert(`Recycle bin emptied: ${total} records deleted forever.`);
    } catch {
      alert('Could not empty the recycle bin. Try again.');
    } finally {
      setEmptying(null);
    }
  };

  /* Paginacion: hasta PAGE_SIZE filas visibles a la vez. */
  const [page, setPage] = useState(1);
  const pageCount = Math.max(Math.ceil(rows.length / PAGE_SIZE), 1);
  const visibleRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  return (
    <div className="trash">
      <Toolbar
        title="Recycle Bin"
        subtitle="Deleted records land here and can be restored"
        searchValue={search}
        onSearchChange={setSearch}
      >
        {can('trash', 'delete') && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={emptying !== null || items.length === 0}
            onClick={() => void handleEmpty()}
            title="Delete every record in the recycle bin forever"
          >
            {emptying !== null ? `Deleting… ${emptying}` : 'Empty recycle bin'}
          </button>
        )}
      </Toolbar>

      <div className="trash__chips">
        <span className="trash__chip">{rows.length} deleted records</span>
      </div>

      <div className="trash__card">
        <table className="trash__table">
          <thead>
            <tr>
              <th className="trash__th trash__th--actions">Actions</th>
              <th className="trash__th">Deleted</th>
              <th className="trash__th">Module</th>
              <th className="trash__th">Record</th>
              <th className="trash__th">Deleted by</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr><td className="trash__empty" colSpan={5}>The recycle bin is empty.</td></tr>
            )}
            {visibleRows.map((item) => (
              <tr key={item.id}>
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
                <td className="trash__td trash__td--muted">{fmtDateTime(item.DELETED_AT)}</td>
                <td className="trash__td trash__td--strong">{moduleLabel(item.ORIGIN_COLLECTION)}</td>
                <td className="trash__td" title={`Record id: ${item.ORIGIN_ID}`}>{summarize(item)}</td>
                <td className="trash__td">{item.DELETED_BY || '\u2014'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > PAGE_SIZE && (
        <div className="trash__pager">
          <span className="trash__pager-info">
            Showing <b>{(page - 1) * PAGE_SIZE + 1}{'\u2013'}{Math.min(page * PAGE_SIZE, rows.length)}</b> of <b>{rows.length}</b>
          </span>
          <span className="trash__pager-actions">
            <button type="button" className="btn btn--secondary" disabled={page === 1} onClick={() => setPage((p) => Math.max(p - 1, 1))}>
              Previous
            </button>
            <span className="trash__pager-page">Page {page} of {pageCount}</span>
            <button type="button" className="btn btn--secondary" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(p + 1, pageCount))}>
              Next
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
