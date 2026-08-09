import type { ReactNode } from 'react';
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
}

/** Tabla generica reutilizada por todos los modulos (compras, ventas, gastos, catalogos, pagos). */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading = false,
  emptyMessage = 'No records found',
  onRowClick,
  onEdit,
  onDelete,
}: DataTableProps<T>) {
  const hasActions = !!onEdit || !!onDelete;
  const colCount = columns.length + (hasActions ? 1 : 0);
  return (
    <div className="data-table">
      <div className="data-table__scroll">
        <table className="data-table__table">
          <thead>
            <tr>
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
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={`data-table__row${onRowClick ? ' data-table__row--clickable' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
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
    </div>
  );
}
