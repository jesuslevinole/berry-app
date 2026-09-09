import { listDocuments, updateDocument, where } from './firestore';
import { round2 } from '../utils/format';
import {
  COLLECTIONS,
  type Expense,
  type PurchaseDetail,
  type PurchaseOrder,
  type SalesOrder,
  type SalesOrderDetail,
} from '../types/models';

/**
 * Totales de un lote calculados desde sus lineas de BD_PURCHASEDETAILS.
 * Regla del negocio: SUBTOTAL y QUANTITY salen de las lineas relacionadas por
 * ID_PURCHASEORDER; la comision aplica el % del lote y el balance descuenta lo pagado.
 */
export interface PurchaseTotals {
  SUBTOTAL: number;
  QUANTITY: number;
  COMMISION_AMOUNT: number;
  TOTAL: number;
  BALANCE: number;
  /** Suma de BD_EXPENSES cuyo ID_PURCHASEORDER apunta a este lote. */
  TOTAL_EXPENSES: number;
  /** Parte deducible (checkbox Deduct) que descuenta la liquidacion. */
  EXPENSES: number;
}

export function computePurchaseTotals(
  order: PurchaseOrder,
  lines: PurchaseDetail[],
  expenses: Expense[] = [],
): PurchaseTotals {
  const subtotal = round2(lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0));
  const quantity = round2(lines.reduce((acc, l) => acc + (l.QUANTITY ?? 0), 0));
  const commission = round2((subtotal * (order.COMMISION_PERCENT ?? 0)) / 100);
  const total = round2(subtotal + commission);
  const totalExpenses = round2(expenses.reduce((acc, e) => acc + (e.AMOUNT ?? 0), 0));
  const deductible = round2(expenses.filter((e) => e.DEDUCT).reduce((acc, e) => acc + (e.AMOUNT ?? 0), 0));
  return {
    SUBTOTAL: subtotal,
    QUANTITY: quantity,
    COMMISION_AMOUNT: commission,
    TOTAL: total,
    BALANCE: round2(total - (order.AMOUNT_PAID ?? 0)),
    TOTAL_EXPENSES: totalExpenses,
    EXPENSES: deductible,
  };
}

/** true si los totales guardados en el lote difieren de los calculados. */
export function purchaseTotalsDiffer(order: PurchaseOrder, totals: PurchaseTotals): boolean {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;
  return !(
    near(order.SUBTOTAL ?? 0, totals.SUBTOTAL) &&
    near(order.QUANTITY ?? 0, totals.QUANTITY) &&
    near(order.COMMISION_AMOUNT ?? 0, totals.COMMISION_AMOUNT) &&
    near(order.TOTAL ?? 0, totals.TOTAL) &&
    near(order.BALANCE ?? 0, totals.BALANCE) &&
    near(order.TOTAL_EXPENSES ?? 0, totals.TOTAL_EXPENSES) &&
    near(order.EXPENSES ?? 0, totals.EXPENSES)
  );
}

/**
 * Recalcula y guarda los totales de los lotes indicados leyendo sus lineas.
 * Se usa tras importar CSV y al abrir el detalle (autocuracion).
 */
export async function syncPurchaseOrderTotals(orderIds: string[], silent = true): Promise<number> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const orders = await listDocuments<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const byId = new Map(orders.map((o) => [o.id, o]));
  let updated = 0;
  for (const orderId of ids) {
    const order = byId.get(orderId);
    if (!order) continue;
    const lines = await listDocuments<PurchaseDetail>(COLLECTIONS.PURCHASE_DETAILS, [
      where('ID_PURCHASEORDER', '==', orderId),
    ]);
    const expenses = await listDocuments<Expense>(COLLECTIONS.EXPENSES, [
      where('ID_PURCHASEORDER', '==', orderId),
    ]);
    const totals = computePurchaseTotals(order, lines, expenses);
    if (!purchaseTotalsDiffer(order, totals)) continue;
    await updateDocument<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER, orderId, totals, { silent });
    updated += 1;
  }
  return updated;
}

/**
 * Recalcula TODOS los lotes de una sola pasada (una lectura de lineas para todos).
 * Pensado para reparar datos importados en bloque.
 */
export async function syncAllPurchaseOrderTotals(): Promise<{ checked: number; updated: number }> {
  const orders = await listDocuments<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const allLines = await listDocuments<PurchaseDetail>(COLLECTIONS.PURCHASE_DETAILS);
  const allExpenses = await listDocuments<Expense>(COLLECTIONS.EXPENSES);
  const byOrder = new Map<string, PurchaseDetail[]>();
  for (const line of allLines) {
    const key = line.ID_PURCHASEORDER;
    if (!key) continue;
    byOrder.set(key, [...(byOrder.get(key) ?? []), line]);
  }
  const expensesByOrder = new Map<string, Expense[]>();
  for (const expense of allExpenses) {
    const key = expense.ID_PURCHASEORDER;
    if (!key) continue;
    expensesByOrder.set(key, [...(expensesByOrder.get(key) ?? []), expense]);
  }
  let updated = 0;
  for (const order of orders) {
    const totals = computePurchaseTotals(order, byOrder.get(order.id) ?? [], expensesByOrder.get(order.id) ?? []);
    if (!purchaseTotalsDiffer(order, totals)) continue;
    await updateDocument<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER, order.id, totals, { silent: true });
    updated += 1;
  }
  return { checked: orders.length, updated };
}

/** Recalcula TOTAL y BALANCE de las ordenes de venta indicadas. */
export async function syncSalesOrderTotals(orderIds: string[], silent = true): Promise<number> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const orders = await listDocuments<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const byId = new Map(orders.map((o) => [o.id, o]));
  let updated = 0;
  for (const orderId of ids) {
    const order = byId.get(orderId);
    if (!order) continue;
    const lines = await listDocuments<SalesOrderDetail>(COLLECTIONS.SALES_ORDER_DETAIL, [
      where('ID_SALESORDER', '==', orderId),
    ]);
    const total = round2(lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0));
    const balance = round2(total - (order.INCOMES ?? 0));
    if (Math.abs((order.TOTAL ?? 0) - total) < 0.01 && Math.abs((order.BALANCE ?? 0) - balance) < 0.01) continue;
    await updateDocument<SalesOrder>(COLLECTIONS.SALES_ORDER, orderId, { TOTAL: total, BALANCE: balance }, { silent });
    updated += 1;
  }
  return updated;
}
