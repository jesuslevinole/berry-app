import type { CSSProperties } from 'react';
import type { MonthRevenue } from '../../services/revenueService';
import { fmtMoney, fmtMoneyCompact } from '../../utils/format';
import './RevenueMonthlyChart.css';

/** Altura relativa (0-100 %) de una columna o linea de la escala: valor en tiempo de ejecucion. */
const levelStyle = (ratio: number): CSSProperties =>
  ({ '--level': `${Math.max(0, Math.min(1, ratio)) * 100}%` }) as CSSProperties;

/** Paso "redondo" de la escala (1, 2 o 5 por potencia de 10) para unas 4 lineas. */
const niceStep = (max: number): number => {
  if (max <= 0) return 100;
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / power;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * power;
};

const paymentsLabel = (count: number): string => (count === 1 ? '1 payment' : `${count} payments`);

interface RevenueMonthlyChartProps {
  months: MonthRevenue[];
}

/**
 * Ingreso por mes (columnas de un solo color, sin leyenda: el titulo dice que es).
 * Solo se rotulan el mes mas alto y el actual; el resto va en el tooltip y la tabla.
 */
export const RevenueMonthlyChart = ({ months }: RevenueMonthlyChartProps) => {
  const max = Math.max(0, ...months.map((month) => month.amount));
  const step = niceStep(max);
  const top = max > 0 ? Math.ceil(max / step) * step : step * 4;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
  const peakKey = max > 0 ? months.find((month) => month.amount === max)?.key : undefined;
  const currentKey = months.at(-1)?.key;

  return (
    <div className="revenue-monthly">
      <div className="revenue-monthly__plot">
        {ticks.map((tick) => (
          <div key={tick} className="revenue-monthly__grid" style={levelStyle(tick / top)}>
            <span className="revenue-monthly__tick">{fmtMoneyCompact(tick)}</span>
          </div>
        ))}

        <div className="revenue-monthly__columns">
          {months.map((month) => {
            const showCap = month.amount > 0 && (month.key === peakKey || month.key === currentKey);
            return (
              <div
                key={month.key}
                className="revenue-monthly__slot"
                style={levelStyle(month.amount / top)}
                tabIndex={0}
                aria-label={`${month.longLabel}: ${fmtMoney(month.amount)}, ${paymentsLabel(month.payments)}`}
              >
                <span className="revenue-monthly__column">
                  {showCap && <span className="revenue-monthly__cap">{fmtMoneyCompact(month.amount)}</span>}
                </span>
                <span className="revenue-monthly__tip" role="tooltip">
                  <strong className="revenue-monthly__tip-title">{month.longLabel}</strong>
                  <span>{fmtMoney(month.amount)}</span>
                  <span className="revenue-monthly__tip-muted">{paymentsLabel(month.payments)}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="revenue-monthly__axis" aria-hidden="true">
        {months.map((month) => (
          <span key={month.key} className="revenue-monthly__label">{month.label}</span>
        ))}
      </div>
    </div>
  );
};
