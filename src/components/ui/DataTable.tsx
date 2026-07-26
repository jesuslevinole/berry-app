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
}

/** Tabla generica reutilizada por todos los modulos (compras, ventas, gastos, catalogos, pagos). */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading = false,
  emptyMessage = 'No records found',
  onRowClick,
}: DataTableProps<T>) {
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
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="data-table__state" colSpan={columns.length}>Loading…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="data-table__state" colSpan={columns.length}>{emptyMessage}</td>
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
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
