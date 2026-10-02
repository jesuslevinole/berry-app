import { round2 } from '../../utils/format';
import { COLLECTIONS, type Expense, type PaymentBase, type PurchaseOrder, type SalesOrder } from '../../types/models';

/**
 * Auditoria de pagos: cruza cada documento (venta, lote, gasto) con sus pagos
 * registrados para que Payments, Sales Desk, Purchase Orders, Expenses y los
 * reportes AR / AP / A/P Growers digan exactamente lo mismo.
 */

export type AuditArea = 'sales' | 'lots' | 'expenses';

export type AuditKind =
  /** El pago apunta a un documento que no existe. */
  | 'orphan'
  /** El documento guarda un "pagado" distinto a la suma de sus pagos. */
  | 'out-of-sync'
  /** El documento dice pagado pero no tiene registros de pago (dato de AppSheet). */
  | 'no-records'
  /** Se pago mas que el total del documento. */
  | 'overpaid';

export interface AuditIssue {
  id: string;
  kind: AuditKind;
  area: AuditArea;
  /** Documento padre (vacio en huerfanos sin coincidencia). */
  docId: string;
  docLabel: string;
  party: string;
  date: string;
  total: number;
  /** Pagado guardado en el documento. */
  storedPaid: number;
  /** Suma de pagos registrados. */
  paymentsSum: number;
  /** Pago huerfano (solo en 'orphan'). */
  paymentId: string;
  paymentAmount: number;
  /** Documento al que se puede re-enlazar el huerfano (coincidencia unica). */
  relinkTo: string;
  relinkLabel: string;
}

export interface AreaMeta {
  area: AuditArea;
  label: string;
  paymentCollection: string;
  parentField: 'ID_SALESORDER' | 'ID_PURCHASEORDER' | 'ID_EXPENSES';
}

export const AREAS: Record<AuditArea, AreaMeta> = {
  sales: { area: 'sales', label: 'Sales orders', paymentCollection: COLLECTIONS.PAYMENT_SALES, parentField: 'ID_SALESORDER' },
  lots: { area: 'lots', label: 'Purchase orders (lots)', paymentCollection: COLLECTIONS.PAYMENT_PURCHASE, parentField: 'ID_PURCHASEORDER' },
  expenses: { area: 'expenses', label: 'Expenses', paymentCollection: COLLECTIONS.PAYMENT_BILL, parentField: 'ID_EXPENSES' },
};

interface ParentView {
  id: string;
  label: string;
  party: string;
  date: string;
  total: number;
  storedPaid: number;
  /** Otros valores con los que un pago importado podria referirse al documento. */
  aliases: string[];
}

const norm = (v: string): string => v.trim().toLowerCase();
const NEAR = 0.005;

function auditArea(area: AuditArea, parents: ParentView[], payments: (PaymentBase & Record<string, unknown>)[]): AuditIssue[] {
  const meta = AREAS[area];
  const issues: AuditIssue[] = [];
  const byId = new Map(parents.map((p) => [p.id, p]));

  /* Alias -> documentos (para re-enlazar huerfanos solo si la coincidencia es unica). */
  const byAlias = new Map<string, string[]>();
  for (const p of parents) {
    for (const a of p.aliases) {
      if (!a.trim()) continue;
      const k = norm(a);
      byAlias.set(k, [...(byAlias.get(k) ?? []), p.id]);
    }
  }

  const blank = {
    docId: '',
    docLabel: '',
    party: '',
    date: '',
    total: 0,
    storedPaid: 0,
    paymentsSum: 0,
    paymentId: '',
    paymentAmount: 0,
    relinkTo: '',
    relinkLabel: '',
  };

  const sumByParent = new Map<string, number>();
  const countByParent = new Map<string, number>();
  for (const pay of payments) {
    const parentId = String(pay[meta.parentField] ?? '');
    if (byId.has(parentId)) {
      sumByParent.set(parentId, round2((sumByParent.get(parentId) ?? 0) + (pay.AMOUNT ?? 0)));
      countByParent.set(parentId, (countByParent.get(parentId) ?? 0) + 1);
      continue;
    }
    const matches = parentId ? [...new Set(byAlias.get(norm(parentId)) ?? [])] : [];
    const target = matches.length === 1 ? byId.get(matches[0]) : undefined;
    issues.push({
      ...blank,
      id: `orphan-${area}-${pay.id}`,
      kind: 'orphan',
      area,
      docLabel: parentId || '(empty)',
      date: pay.DATE ?? '',
      paymentId: pay.id,
      paymentAmount: round2(pay.AMOUNT ?? 0),
      relinkTo: target?.id ?? '',
      relinkLabel: target?.label ?? '',
    });
  }

  for (const p of parents) {
    const count = countByParent.get(p.id) ?? 0;
    const sum = sumByParent.get(p.id) ?? 0;
    const base = { ...blank, area, docId: p.id, docLabel: p.label, party: p.party, date: p.date, total: p.total, storedPaid: p.storedPaid, paymentsSum: sum };
    if (count > 0 && Math.abs(sum - p.storedPaid) > NEAR) {
      issues.push({ ...base, id: `sync-${area}-${p.id}`, kind: 'out-of-sync' });
    } else if (count === 0 && p.storedPaid > NEAR) {
      issues.push({ ...base, id: `norec-${area}-${p.id}`, kind: 'no-records' });
    }
    const paid = count > 0 ? sum : p.storedPaid;
    if (paid - p.total > NEAR && p.total > 0) {
      issues.push({ ...base, id: `over-${area}-${p.id}`, kind: 'overpaid' });
    }
  }
  return issues;
}

interface AuditInput {
  salesOrders: SalesOrder[];
  salesPayments: PaymentBase[];
  purchaseOrders: PurchaseOrder[];
  purchasePayments: PaymentBase[];
  expenses: Expense[];
  billPayments: PaymentBase[];
  customerName: (id?: string) => string;
  growerName: (id?: string) => string;
  supplierName: (id?: string) => string;
}

export function auditPayments(input: AuditInput): AuditIssue[] {
  const cast = (rows: PaymentBase[]) => rows as (PaymentBase & Record<string, unknown>)[];
  const lotOf = new Map(input.purchaseOrders.map((po) => [po.id, po.LOT_NUMBER ?? '']));

  const sales: ParentView[] = input.salesOrders
    .filter((so) => so.STATUS !== 'Cancelled')
    .map((so) => ({
      id: so.id,
      label: so.SALES_ORDER_NUMBER || '(no #)',
      party: input.customerName(so.ID_CUSTOMER),
      date: so.DATE ?? '',
      total: round2(so.TOTAL ?? 0),
      storedPaid: round2(so.INCOMES ?? 0),
      aliases: [so.SALES_ORDER_NUMBER ?? ''],
    }));

  const lots: ParentView[] = input.purchaseOrders.map((po) => ({
    id: po.id,
    label: po.LOT_NUMBER || po.REF_NUMBER || '(no lot #)',
    party: input.growerName(po.ID_GROWER),
    date: po.ARRIVAL_DATE ?? '',
    total: round2(po.TOTAL ?? 0),
    storedPaid: round2(po.AMOUNT_PAID ?? 0),
    aliases: [po.LOT_NUMBER ?? '', po.REF_NUMBER ?? ''],
  }));

  const expenses: ParentView[] = input.expenses.map((e) => ({
    id: e.id,
    label: [lotOf.get(e.ID_PURCHASEORDER), e.INVOICE_NUMBER].filter(Boolean).join(' · ') || '(no invoice #)',
    party: input.supplierName(e.ID_SUPPLIERS),
    date: e.DATE ?? '',
    total: round2(e.AMOUNT ?? 0),
    storedPaid: round2(e.PAY_AMOUNT ?? 0),
    aliases: [e.INVOICE_NUMBER ?? ''],
  }));

  return [
    ...auditArea('sales', sales, cast(input.salesPayments)),
    ...auditArea('lots', lots, cast(input.purchasePayments)),
    ...auditArea('expenses', expenses, cast(input.billPayments)),
  ];
}
