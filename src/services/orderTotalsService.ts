import { listDocuments, updateDocument, where, getDocumentsById } from './firestore';
import { round2 } from '../utils/format';
import {
  COLLECTIONS,
  type Expense,
  type PurchaseDetail,
  type PurchaseOrder,
  type PaymentBill,
  type PaymentPurchase,
  type PaymentSales,
  type SalesOrder,
  type SalesOrderDetail,
} from '../types/models';

/**
 * Totales de un lote calculados desde sus lineas de BD_PURCHASEDETAILS.
 * Regla del negocio (la misma de la liquidacion que recibe el grower):
 *   TOTAL   = SUBTOTAL - COMISION - GASTOS DEDUCIBLES   (lo que se le debe al grower)
 *   BALANCE = TOTAL - PAGADO
 * La comision es de Berry Source: se DESCUENTA al grower, no se le suma.
 */
export interface PurchaseTotals {
  SUBTOTAL: number;
  QUANTITY: number;
  COMMISION_AMOUNT: number;
  TOTAL: number;
  /** Pagado al grower: suma de los pagos del lote. */
  AMOUNT_PAID: number;
  BALANCE: number;
  /** Suma de BD_EXPENSES cuyo ID_PURCHASEORDER apunta a este lote. */
  TOTAL_EXPENSES: number;
  /** Parte deducible (checkbox Deduct) que descuenta la liquidacion. */
  EXPENSES: number;
}

/** Opciones de recalculo. */
export interface SyncOptions {
  /**
   * true = los pagos acaban de cambiar en el app (alta, edicion o borrado), asi
   * que la suma de pagos manda aunque quede en 0. Por defecto, si el documento no
   * tiene pagos registrados se conserva lo pagado guardado (dato de AppSheet).
   */
  paymentsChanged?: boolean;
}

/**
 * Gastos que se descuentan al grower (misma regla que el Liquidation Report):
 * SOLO los marcados Deduct. Los no marcados no se descuentan. Si el lote no tiene
 * gastos registrados, se conserva el valor guardado (importado de AppSheet).
 */
export function liquidationDeduction(order: PurchaseOrder, expenses: Expense[]): number {
  if (expenses.length === 0) return round2(order.TOTAL_EXPENSES ?? order.EXPENSES ?? 0);
  return round2(deductibleExpenses(expenses).reduce((acc, e) => acc + (e.AMOUNT ?? 0), 0));
}

/** Gastos que se descuentan en la liquidacion: los marcados Deduct. */
export const deductibleExpenses = (expenses: Expense[]): Expense[] => expenses.filter((e) => e.DEDUCT === true);

export function computePurchaseTotals(
  order: PurchaseOrder,
  lines: PurchaseDetail[],
  expenses: Expense[] = [],
  payments: PaymentPurchase[] = [],
  options: SyncOptions = {},
): PurchaseTotals {
  const subtotal = round2(lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0));
  const quantity = round2(lines.reduce((acc, l) => acc + (l.QUANTITY ?? 0), 0));
  const commission = round2((subtotal * (order.COMMISION_PERCENT ?? 0)) / 100);
  const totalExpenses = expenses.length > 0
    ? round2(expenses.reduce((acc, e) => acc + (e.AMOUNT ?? 0), 0))
    : round2(order.TOTAL_EXPENSES ?? 0);
  const deductible = liquidationDeduction(order, expenses);
  /* Lo que se le debe al grower (Total liquidation). */
  const total = round2(subtotal - commission - deductible);
  /* Pagado: la suma de pagos manda si hay pagos (o si acaban de cambiar); si no, el valor guardado. */
  const paid = payments.length > 0 || options.paymentsChanged
    ? round2(payments.reduce((acc, p) => acc + (p.AMOUNT ?? 0), 0))
    : round2(order.AMOUNT_PAID ?? 0);
  return {
    SUBTOTAL: subtotal,
    QUANTITY: quantity,
    COMMISION_AMOUNT: commission,
    TOTAL: total,
    AMOUNT_PAID: paid,
    BALANCE: round2(total - paid),
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
    near(order.AMOUNT_PAID ?? 0, totals.AMOUNT_PAID) &&
    near(order.BALANCE ?? 0, totals.BALANCE) &&
    near(order.TOTAL_EXPENSES ?? 0, totals.TOTAL_EXPENSES) &&
    near(order.EXPENSES ?? 0, totals.EXPENSES)
  );
}

/**
 * Recalcula y guarda los totales de los lotes indicados leyendo sus lineas.
 * Se usa tras importar CSV y al abrir el detalle (autocuracion).
 */
export async function syncPurchaseOrderTotals(orderIds: string[], silent = true, options: SyncOptions = {}): Promise<number> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  /* Solo los lotes afectados (antes se leian TODOS los Purchase Orders en cada cambio). */
  const byId = await getDocumentsById<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER, ids);
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
    const payments = await listDocuments<PaymentPurchase>(COLLECTIONS.PAYMENT_PURCHASE, [
      where('ID_PURCHASEORDER', '==', orderId),
    ]);
    const totals = computePurchaseTotals(order, lines, expenses, payments, options);
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
  const allPayments = await listDocuments<PaymentPurchase>(COLLECTIONS.PAYMENT_PURCHASE);
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
  const paymentsByOrder = new Map<string, PaymentPurchase[]>();
  for (const payment of allPayments) {
    const key = payment.ID_PURCHASEORDER;
    if (!key) continue;
    paymentsByOrder.set(key, [...(paymentsByOrder.get(key) ?? []), payment]);
  }
  let updated = 0;
  for (const order of orders) {
    const totals = computePurchaseTotals(
      order,
      byOrder.get(order.id) ?? [],
      expensesByOrder.get(order.id) ?? [],
      paymentsByOrder.get(order.id) ?? [],
    );
    if (!purchaseTotalsDiffer(order, totals)) continue;
    await updateDocument<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER, order.id, totals, { silent: true });
    updated += 1;
  }
  return { checked: orders.length, updated };
}

/**
 * Totales de una orden de venta: TOTAL = suma de lineas; cobrado = suma de pagos.
 * Si la orden no tiene pagos registrados se conserva el INCOMES guardado (cobros de
 * AppSheet que no se importaron como pagos), salvo que los pagos acaben de cambiar.
 * Sin lineas se conserva el TOTAL guardado.
 */
export function computeSalesTotals(
  order: SalesOrder,
  lines: SalesOrderDetail[],
  payments: PaymentSales[],
  options: SyncOptions = {},
): { TOTAL: number; INCOMES: number; BALANCE: number } {
  const total = lines.length > 0 ? round2(lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0)) : round2(order.TOTAL ?? 0);
  const incomes = payments.length > 0 || options.paymentsChanged
    ? round2(payments.reduce((acc, p) => acc + (p.AMOUNT ?? 0), 0))
    : round2(order.INCOMES ?? 0);
  return { TOTAL: total, INCOMES: incomes, BALANCE: round2(total - incomes) };
}

const salesDiffer = (order: SalesOrder, t: { TOTAL: number; INCOMES: number; BALANCE: number }): boolean =>
  !(
    Math.abs((order.TOTAL ?? 0) - t.TOTAL) < 0.01 &&
    Math.abs((order.INCOMES ?? 0) - t.INCOMES) < 0.01 &&
    Math.abs((order.BALANCE ?? 0) - t.BALANCE) < 0.01
  );

/** Recalcula TOTAL y BALANCE de las ordenes de venta indicadas. */
export async function syncSalesOrderTotals(orderIds: string[], silent = true, options: SyncOptions = {}): Promise<number> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  /* Solo las ordenes afectadas (antes se leian TODAS las ventas en cada cambio). */
  const byId = await getDocumentsById<SalesOrder>(COLLECTIONS.SALES_ORDER, ids);
  let updated = 0;
  for (const orderId of ids) {
    const order = byId.get(orderId);
    if (!order) continue;
    const lines = await listDocuments<SalesOrderDetail>(COLLECTIONS.SALES_ORDER_DETAIL, [
      where('ID_SALESORDER', '==', orderId),
    ]);
    const payments = await listDocuments<PaymentSales>(COLLECTIONS.PAYMENT_SALES, [
      where('ID_SALESORDER', '==', orderId),
    ]);
    const totals = computeSalesTotals(order, lines, payments, options);
    if (!salesDiffer(order, totals)) continue;
    await updateDocument<SalesOrder>(COLLECTIONS.SALES_ORDER, orderId, totals, { silent });
    updated += 1;
  }
  return updated;
}

/** Recalcula TODAS las ordenes de venta de una pasada (reparacion en bloque). */
export async function syncAllSalesOrderTotals(): Promise<{ checked: number; updated: number }> {
  const orders = await listDocuments<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const allLines = await listDocuments<SalesOrderDetail>(COLLECTIONS.SALES_ORDER_DETAIL);
  const allPayments = await listDocuments<PaymentSales>(COLLECTIONS.PAYMENT_SALES);
  const group = <T,>(rows: T[], keyOf: (r: T) => string | undefined): Map<string, T[]> => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const k = keyOf(r);
      if (k) map.set(k, [...(map.get(k) ?? []), r]);
    }
    return map;
  };
  const linesBy = group(allLines, (l) => l.ID_SALESORDER);
  const paymentsBy = group(allPayments, (p) => p.ID_SALESORDER);
  let updated = 0;
  for (const order of orders) {
    const totals = computeSalesTotals(order, linesBy.get(order.id) ?? [], paymentsBy.get(order.id) ?? []);
    if (!salesDiffer(order, totals)) continue;
    await updateDocument<SalesOrder>(COLLECTIONS.SALES_ORDER, order.id, totals, { silent: true });
    updated += 1;
  }
  return { checked: orders.length, updated };
}

/** Recalcula pagado y saldo de los gastos indicados desde sus pagos. */
export async function syncExpenseTotals(expenseIds: string[], silent = true, options: SyncOptions = {}): Promise<number> {
  const ids = [...new Set(expenseIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  /* Solo los gastos afectados (antes se leian TODOS los gastos en cada cambio). */
  const byId = await getDocumentsById<Expense>(COLLECTIONS.EXPENSES, ids);
  let updated = 0;
  for (const expenseId of ids) {
    const expense = byId.get(expenseId);
    if (!expense) continue;
    const payments = await listDocuments<PaymentBill>(COLLECTIONS.PAYMENT_BILL, [
      where('ID_EXPENSES', '==', expenseId),
    ]);
    /* Sin pagos registrados se conserva lo pagado guardado, salvo que los pagos acaben de cambiar. */
    const paid = payments.length > 0 || options.paymentsChanged
      ? round2(payments.reduce((acc, p) => acc + (p.AMOUNT ?? 0), 0))
      : round2(expense.PAY_AMOUNT ?? 0);
    const balance = round2((expense.AMOUNT ?? 0) - paid);
    if (Math.abs((expense.PAY_AMOUNT ?? 0) - paid) < 0.01 && Math.abs((expense.BALANCE ?? 0) - balance) < 0.01) continue;
    await updateDocument<Expense>(COLLECTIONS.EXPENSES, expenseId, { PAY_AMOUNT: paid, BALANCE: balance }, { silent });
    updated += 1;
  }
  return updated;
}
