import { useMemo, useState, type ReactNode } from 'react';
import { PAGE_SIZE } from '../../config/limits';
import './DataTable.css';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T extends { id: string }> {
  columns: Array<Column<T>>;
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  /** Muestra el boton "Edit" en la columna final (gatear con can(modulo,'edit')). */
  onEdit?: (row: T) => void;
  /** Muestra el boton "Delete" en la columna final (gatear con can(modulo,'delete')). */
  onDelete?: (row: T) => void;
  /** Filas por pagina (por defecto 50, definido en config/limits). */
  pageSize?: number;
  /**
   * Borrado masivo: al pasarlo aparece una casilla al inicio de cada fila y
   * una barra con "N seleccionados". Recibe las filas marcadas y las borra.
   */
  onBulkDelete?: (rows: T[]) => Promise<void>;
  /** Texto de lo que se borra, para el mensaje de confirmacion ("orders", "expenses"). */
  bulkLabel?: string;
}

/**
 * Tabla generica reutilizada por todos los modulos.
 * - Acciones (Edit / Delete) en la ULTIMA columna, fija a la derecha: siempre
 *   alcanzables aunque la tabla sea mas ancha que la pantalla.
 * - La tabla vive en una caja con alto maximo: la barra horizontal queda
 *   siempre visible sin tener que bajar hasta el final de la pagina.
 * - Paginacion de 50 filas.
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading = false,
  emptyMessage = 'No records found',
  onRowClick,
  onEdit,
  onDelete,
  pageSize = PAGE_SIZE,
  onBulkDelete,
  bulkLabel = 'records',
}: DataTableProps<T>) {
  const hasActions = !!onEdit || !!onDelete;
  const selectable = !!onBulkDelete;
  const colCount = columns.length + (hasActions ? 1 : 0) + (selectable ? 1 : 0);

  /* ---- Seleccion multiple ---- */
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [borrando, setBorrando] = useState(false);

  const alternar = (id: string) =>
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* Paginacion: nunca se pintan mas de pageSize filas a la vez. */
  const [requestedPage, setPage] = useState(1);
  const pageCount = Math.max(Math.ceil(rows.length / pageSize), 1);
  /* Si los datos se reducen (filtro, busqueda), la pagina se ajusta sola. */
  const page = Math.min(requestedPage, pageCount);
  const visibleRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );
  const firstShown = rows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, rows.length);

  /* Solo cuentan las filas visibles en la lista actual (filtros incluidos). */
  const idsVisibles = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const seleccionados = useMemo(() => rows.filter((r) => seleccion.has(r.id)), [rows, seleccion]);
  const paginaMarcada = visibleRows.length > 0 && visibleRows.every((r) => seleccion.has(r.id));

  const alternarPagina = () =>
    setSeleccion((prev) => {
      const next = new Set([...prev].filter((id) => idsVisibles.has(id)));
      if (paginaMarcada) visibleRows.forEach((r) => next.delete(r.id));
      else visibleRows.forEach((r) => next.add(r.id));
      return next;
    });

  const borrarSeleccionados = async () => {
    if (!onBulkDelete || seleccionados.length === 0) return;
    const total = seleccionados.length;
    if (!window.confirm(`Delete ${total} ${bulkLabel}?\n\nThey go to the Recycle Bin and can be restored.`)) return;
    setBorrando(true);
    try {
      await onBulkDelete(seleccionados);
      setSeleccion(new Set());
    } catch (error) {
      alert(`Some records could not be deleted: ${(error as Error).message ?? 'Unknown error'}`);
    } finally {
      setBorrando(false);
    }
  };

  return (
    <div className="data-table">
      {selectable && seleccionados.length > 0 && (
        <div className="data-table__bulk">
          <span className="data-table__bulk-info">
            <b>{seleccionados.length}</b> selected
          </span>
          <span className="data-table__bulk-actions">
            {seleccionados.length < rows.length && (
              <button type="button" className="data-table__bulk-link" disabled={borrando}
                onClick={() => setSeleccion(new Set(rows.map((r) => r.id)))}>
                Select all {rows.length}
              </button>
            )}
            <button type="button" className="data-table__bulk-link" disabled={borrando} onClick={() => setSeleccion(new Set())}>
              Clear
            </button>
            <button type="button" className="data-table__bulk-delete" disabled={borrando} onClick={() => void borrarSeleccionados()}>
              {borrando ? 'Deleting…' : `Delete ${seleccionados.length}`}
            </button>
          </span>
        </div>
      )}

      <div className="data-table__scroll">
        <table className="data-table__table">
          <thead>
            <tr>
              {selectable && (
                <th className="data-table__th data-table__check">
                  <input
                    type="checkbox"
                    aria-label="Select the rows on this page"
                    checked={paginaMarcada}
                    onChange={alternarPagina}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`data-table__th data-table__cell--${col.align ?? 'left'}`}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
              {hasActions && (
                <th className="data-table__th data-table__cell--right data-table__actions-th">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="data-table__state" colSpan={colCount}>Loading…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="data-table__state" colSpan={colCount}>{emptyMessage}</td>
              </tr>
            )}
            {!loading &&
              visibleRows.map((row) => (
                <tr
                  key={row.id}
                  className={`data-table__row${onRowClick ? ' data-table__row--clickable' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selectable && (
                    <td className="data-table__td data-table__check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={seleccion.has(row.id)}
                        onChange={() => alternar(row.id)}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={`data-table__td data-table__cell--${col.align ?? 'left'}`}>
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                  {hasActions && (
                    <td className="data-table__td data-table__cell--right data-table__actions">
                      {onEdit && (
                        <button
                          type="button"
                          className="data-table__action data-table__action--edit"
                          title="Edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(row);
                          }}
                        >
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
                            <path d="M17 3l4 4L8 20H4v-4L17 3z" />
                          </svg>
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          className="data-table__action data-table__action--delete"
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(row);
                          }}
                        >
                          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
                            <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6" />
                          </svg>
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {!loading && rows.length > pageSize && (
        <div className="data-table__pager">
          <span className="data-table__pager-info">
            Showing <b>{firstShown}–{lastShown}</b> of <b>{rows.length}</b>
          </span>
          <span className="data-table__pager-actions">
            <button
              type="button"
              className="data-table__pager-btn"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
            >
              Previous
            </button>
            <span className="data-table__pager-page">Page {page} of {pageCount}</span>
            <button
              type="button"
              className="data-table__pager-btn"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(p + 1, pageCount))}
            >
              Next
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
