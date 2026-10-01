import { round2 } from '../utils/format';
import type { Expense, PaymentBill, PaymentSales, PurchaseOrder, SalesOrder } from '../types/models';

/**
 * Saldos EN VIVO, calculados desde los pagos reales. Fuente unica para el
 * Dashboard y los reportes (AR, AP, A/P Growers): asi los numeros siempre cuadran.
 * El BALANCE guardado en cada documento puede estar viejo (pagos importados o
 * borrados sin recalcular), por eso no se usa para totales.
 */

/** Saldos menores a medio centavo se consideran liquidados. */
export const SETTLED = 0.005;

export interface LiveBalance {
  paid: number;
  balance: number;
}

/** Suma de pagos por documento padre. */
function sumBy<T extends { AMOUNT?: number }>(payments: T[], parentOf: (p: T) => string | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payments) {
    const parent = parentOf(p);
    if (!parent) continue;
    map.set(parent, round2((map.get(parent) ?? 0) + (p.AMOUNT ?? 0)));
  }
  return map;
}

/** Resolutor de saldo por venta: total - cobrado (pagos reales; si no hay, el dato guardado). */
export function saleBalanceResolver(salesPayments: PaymentSales[]): (so: SalesOrder) => LiveBalance {
  const collected = sumBy(salesPayments, (p) => p.ID_SALESORDER);
  return (so) => {
    const paid = collected.has(so.id) ? (collected.get(so.id) as number) : round2(so.INCOMES ?? 0);
    return { paid, balance: round2((so.TOTAL ?? 0) - paid) };
  };
}

/** Resolutor de saldo por gasto: monto - pagado (pagos reales; si no hay, el dato guardado). */
export function expenseBalanceResolver(billPayments: PaymentBill[]): (e: Expense) => LiveBalance {
  const paidBy = sumBy(billPayments, (p) => p.ID_EXPENSES);
  return (e) => {
    const paid = paidBy.has(e.id) ? (paidBy.get(e.id) as number) : round2(e.PAY_AMOUNT ?? 0);
    return { paid, balance: round2((e.AMOUNT ?? 0) - paid) };
  };
}

/** Saldo por pagar al grower de un lote (misma regla que A/P Growers). */
export const purchaseBalance = (po: PurchaseOrder): number =>
  round2(po.BALANCE ?? (po.TOTAL ?? 0) - (po.AMOUNT_PAID ?? 0));

/** Total por cobrar: ventas no canceladas con saldo pendiente (= Accounts Receivable). */
export function receivableTotal(salesOrders: SalesOrder[], salesPayments: PaymentSales[]): number {
  const balanceOf = saleBalanceResolver(salesPayments);
  return round2(
    salesOrders
      .filter((so) => so.STATUS !== 'Cancelled')
      .map((so) => balanceOf(so).balance)
      .filter((b) => b > SETTLED)
      .reduce((acc, b) => acc + b, 0),
  );
}

/** Total por pagar de gastos con saldo pendiente (= Accounts Payable). */
export function payableTotal(expenses: Expense[], billPayments: PaymentBill[]): number {
  const balanceOf = expenseBalanceResolver(billPayments);
  return round2(
    expenses
      .map((e) => balanceOf(e).balance)
      .filter((b) => b > SETTLED)
      .reduce((acc, b) => acc + b, 0),
  );
}

/** Total por pagar a growers: lotes con saldo pendiente (= A/P Growers). */
export function growersPayableTotal(purchaseOrders: PurchaseOrder[]): number {
  return round2(
    purchaseOrders
      .map(purchaseBalance)
      .filter((b) => b > SETTLED)
      .reduce((acc, b) => acc + b, 0),
  );
}
