import type { CSSProperties } from 'react';
import type { CompanyRevenue } from '../../services/revenueService';
import { fmtMoney } from '../../utils/format';
import './RevenueByCompanyChart.css';

/** Empresas que se muestran por nombre; el resto se suma en "Other". */
const MAX_ROWS = 8;

const widthStyle = (ratio: number): CSSProperties =>
  ({ '--level': `${Math.max(0, Math.min(1, ratio)) * 100}%` }) as CSSProperties;

/** Junta las empresas que no caben en una fila "Other" (nunca se inventan mas barras). */
const foldRows = (rows: CompanyRevenue[]): CompanyRevenue[] => {
  if (rows.length <= MAX_ROWS) return rows;
  const shown = rows.slice(0, MAX_ROWS - 1);
  const rest = rows.slice(MAX_ROWS - 1);
  const other = rest.reduce<CompanyRevenue>(
    (sum, row) => ({ ...sum, amount: sum.amount + row.amount, payments: sum.payments + row.payments }),
    { companyId: '__other__', name: `Other (${rest.length})`, amount: 0, payments: 0 },
  );
  return [...shown, other];
};

interface RevenueByCompanyChartProps {
  rows: CompanyRevenue[];
}

/** Ingreso por empresa: barras horizontales de un solo color, valor al final de cada barra. */
export const RevenueByCompanyChart = ({ rows }: RevenueByCompanyChartProps) => {
  const visibleRows = foldRows(rows);
  const max = Math.max(0, ...visibleRows.map((row) => row.amount));

  return (
    <ul className="revenue-company">
      {visibleRows.map((row) => (
        <li
          key={row.companyId}
          className="revenue-company__row"
          style={widthStyle(max > 0 ? row.amount / max : 0)}
          tabIndex={0}
          aria-label={`${row.name}: ${fmtMoney(row.amount)}, ${row.payments} payments`}
        >
          <span className="revenue-company__name">{row.name}</span>
          <span className="revenue-company__track">
            <span className="revenue-company__bar" />
            <span className="revenue-company__value">{fmtMoney(row.amount)}</span>
          </span>
          <span className="revenue-company__tip" role="tooltip">
            {row.payments === 1 ? '1 payment' : `${row.payments} payments`}
          </span>
        </li>
      ))}
    </ul>
  );
};
