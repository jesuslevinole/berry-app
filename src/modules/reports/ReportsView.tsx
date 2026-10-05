import { useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { FORM_DEFS } from '../../config/formDefs';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { Toolbar } from '../../components/ui/Toolbar';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { SalesOrderDetailPanel } from '../sales/SalesOrderDetailPanel';
import { PurchaseOrderDetailPanel } from '../purchases/PurchaseOrderDetailPanel';
import { PaymentsPanel } from '../payments/PaymentsPanel';
import { PaymentsAuditPanel } from '../payments/PaymentsAuditPanel';
import { CustomerStatementModal } from './CustomerStatementModal';
import { useCompany } from '../../hooks/useCompany';
import { Modal } from '../../components/ui/Modal';
import { updateDocument } from '../../services/firestore';
import { expenseBalanceResolver, purchaseBalance, saleBalanceResolver, SETTLED } from '../../services/balances';
import { fmtMoney, round2, todayISO } from '../../utils/format';
import { PAGE_SIZE } from '../../config/limits';
import {
  COLLECTIONS,
  type Expense,
  type PaymentBill,
  type PaymentSales,
  type PurchaseOrder,
  type SalesOrder,
  type SystemUser,
} from '../../types/models';
import './ReportsView.css';

export type ReportId = 'queue' | 'apgrowers' | 'ap' | 'ar' | 'expenses';

/** Cada reporte es un modulo independiente: titulo y modulo de permisos propios. */
const REPORT_META: Record<ReportId, { title: string; moduleId: string }> = {
  queue: { title: 'Invoice Queue', moduleId: 'queue' },
  apgrowers: { title: 'A/P Growers', moduleId: 'apgrowers' },
  ap: { title: 'Accounts Payable', moduleId: 'ap' },
  ar: { title: 'Accounts Receivable', moduleId: 'ar' },
  expenses: { title: 'Expenses Report', moduleId: 'expensesreport' },
};

/** yyyy-mm-dd -> m/d/yyyy (formato de Estados Unidos). */
const fmtDate = (iso: string): string => {
  if (!iso) return '\u2014';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}` : iso;
};

/** Dias contra vencimiento: negativo = vencido (como en AppSheet). */
const overdueDays = (dueDate: string): number | null => {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date(`${todayISO()}T00:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
};

/** Dias de credito por defecto con los growers si el PO no trae payment term. */
const DEFAULT_GROWER_TERM_DAYS = 21;

/** yyyy-mm-dd + n dias. */
const addDaysISO = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** "21 Days" / "Net 30" -> 21 / 30. */
const termDaysFrom = (name: string): number | null => {
  const match = /\d+/.exec(name);
  return match ? parseInt(match[0], 10) : null;
};

interface ExportColumn {
  header: string;
  values: (string | number)[];
}

/** Exporta un reporte a Excel con encabezado de marca. */
async function exportReport(title: string, columns: ExportColumn[]): Promise<void> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title.slice(0, 31));
  const colCount = columns.length;
  const rowCount = columns[0]?.values.length ?? 0;

  const titleRow = sheet.getRow(1);
  titleRow.getCell(1).value = title;
  titleRow.getCell(1).font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF1F7A4D' } };
  sheet.mergeCells(1, 1, 1, Math.max(colCount, 1));

  const dateRow = sheet.getRow(2);
  dateRow.getCell(1).value = `Generated: ${new Date().toLocaleString('en-US')}`;
  dateRow.getCell(1).font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(2, 1, 2, Math.max(colCount, 1));

  const headerRow = sheet.getRow(4);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F7A4D' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  for (let r = 0; r < rowCount; r += 1) {
    const row = sheet.getRow(5 + r);
    columns.forEach((col, c) => {
      row.getCell(c + 1).value = col.values[r];
    });
  }

  columns.forEach((col, i) => {
    const width = Math.max(col.header.length, ...col.values.map((v) => String(v).length)) + 3;
    sheet.getColumn(i + 1).width = Math.min(width, 40);
  });
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: Math.max(colCount, 1) } };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.toLowerCase().replace(/\s+/g, '-')}-${todayISO()}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

interface ReportsViewProps {
  /** Reporte que muestra esta vista (cada uno es su propio modulo del menu). */
  report: ReportId;
}

export function ReportsView({ report }: ReportsViewProps) {
  const { can } = useAuth();
  const { fieldsFor } = useAppConfig();
  const [search, setSearch] = useState('');
  /* Paginacion: hasta PAGE_SIZE filas por tabla. */
  const [page, setPage] = useState(1);
  const paginate = <R,>(list: R[]): R[] => list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagerFor = (total: number) => {
    const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    if (total <= PAGE_SIZE) return null;
    return (
      <div className="reports__pager">
        <span className="reports__pager-info">
          Showing <b>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}</b> of <b>{total}</b>
        </span>
        <span className="reports__pager-actions">
          <button type="button" className="btn btn--secondary" disabled={page === 1} onClick={() => setPage((p) => Math.max(p - 1, 1))}>Previous</button>
          <span className="reports__pager-page">Page {page} of {pageCount}</span>
          <button type="button" className="btn btn--secondary" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(p + 1, pageCount))}>Next</button>
        </span>
      </div>
    );
  };

  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const { data: salesOrders } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: expenses } = useCollection<Expense>(COLLECTIONS.EXPENSES);
  const { data: billPayments } = useCollection<PaymentBill>(COLLECTIONS.PAYMENT_BILL);
  const { data: salesPayments } = useCollection<PaymentSales>(COLLECTIONS.PAYMENT_SALES);
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const categories = useCatalog(COLLECTIONS.CATEGORY_BILL, 'NAME');
  const legacyUsers = useCatalog(COLLECTIONS.USERS, 'EMAIL_USERS');
  const paymentTerms = useCatalog(COLLECTIONS.PAYMENTTERM, 'NAME_PAYMENTTERM');
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);

  const term = search.trim().toLowerCase();
  const matches = (...values: string[]): boolean =>
    !term || values.some((v) => v.toLowerCase().includes(term));

  /** Resuelve salesperson: usuarios del sistema primero, catalogo legado despues. */
  const buyerName = useMemo(() => {
    const map = new Map(
      systemUsers.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]),
    );
    return (id?: string): string => (id ? (map.get(id) ?? legacyUsers.nameOf(id)) : '\u2014');
  }, [systemUsers, legacyUsers]);

  /* ---- Saldos EN VIVO desde los pagos reales (los guardados pueden estar viejos) ---- */

  /** Saldo de una venta / un gasto con los pagos reales (mismo calculo que el Dashboard). */
  const saleBalance = useMemo(() => saleBalanceResolver(salesPayments), [salesPayments]);
  const expenseBalance = useMemo(() => expenseBalanceResolver(billPayments), [billPayments]);

  /* Detalle abierto dentro de Reports (sin salir de la vista). */
  const [viewingSale, setViewingSale] = useState<SalesOrder | null>(null);
  const [viewingPurchase, setViewingPurchase] = useState<PurchaseOrder | null>(null);

  /** Abre el detalle del gasto o lote: su Purchase Order asociado. */
  const openPurchase = (purchaseOrderId?: string) => {
    const po = purchaseOrders.find((p) => p.id === purchaseOrderId);
    if (po) setViewingPurchase(po);
  };

  /* ---- 1. Invoice Queue: ordenes pendientes de cargar ---- */
  const queueRows = useMemo(
    () =>
      salesOrders
        /* Pendientes de cargar: sin palomeo y con estado anterior a Loaded. */
        .filter(
          (so) =>
            !so.LOADED &&
            so.STATUS !== 'Cancelled' &&
            so.STATUS !== 'Loaded' &&
            so.STATUS !== 'Delivered' &&
            so.STATUS !== 'Paid',
        )
        .filter((so) =>
          matches(
            so.SALES_ORDER_NUMBER ?? '',
            customers.nameOf(so.ID_CUSTOMER),
            so.BUYER ?? '',
            buyerName(so.ID_USERS),
            so.STATUS ?? '',
          ),
        )
        .sort((a, b) => (a.DATE ?? '').localeCompare(b.DATE ?? '') || (a.SALES_ORDER_NUMBER ?? '').localeCompare(b.SALES_ORDER_NUMBER ?? '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salesOrders, customers, buyerName, term],
  );

  const queueTotal = round2(queueRows.reduce((acc, so) => acc + (so.TOTAL ?? 0), 0));

  /* ---- 2. A/P Growers: POs con saldo pendiente al grower, agrupadas por grower ---- */
  /* Grower seleccionado en el panel izquierdo ('' = All), como en AppSheet. */
  const [apGrower, setApGrower] = useState('');

  /** Vencimiento del lote: llegada + dias del payment term (del PO o el de la empresa). */
  const poDueDate = useMemo(() => {
    const companyTerm = paymentTerms.options[0]?.name ?? '';
    return (po: PurchaseOrder): string => {
      if (!po.ARRIVAL_DATE) return '';
      const termName = po.ID_PAYMENTTERM ? paymentTerms.nameOf(po.ID_PAYMENTTERM) : companyTerm;
      const days = termDaysFrom(termName) ?? termDaysFrom(companyTerm) ?? DEFAULT_GROWER_TERM_DAYS;
      return addDaysISO(po.ARRIVAL_DATE, days);
    };
  }, [paymentTerms]);

  const apGrowerGroups = useMemo(() => {
    const today = todayISO();
    const pending = purchaseOrders
      .map((po) => {
        const dueDate = poDueDate(po);
        return {
          po,
          balance: purchaseBalance(po),
          growerName: growers.nameOf(po.ID_GROWER),
          dueDate,
          /* Rojo: ya paso el due date y sigue sin pagarse. */
          overdue: !!dueDate && dueDate < today,
        };
      })
      .filter((r) => r.balance > SETTLED)
      .filter((r) =>
        matches(r.growerName, customers.nameOf(r.po.ID_CUSTOMER), r.po.LOT_NUMBER ?? '', r.po.REF_NUMBER ?? ''),
      );
    const byGrower = new Map<string, typeof pending>();
    for (const row of pending) {
      const key = row.po.ID_GROWER || '';
      byGrower.set(key, [...(byGrower.get(key) ?? []), row]);
    }
    return [...byGrower.entries()]
      .map(([growerId, rows]) => ({
        growerId,
        growerName: growers.nameOf(growerId),
        /* Mas recientes arriba, por Arrival Date. */
        rows: rows.sort(
          (a, b) =>
            (b.po.ARRIVAL_DATE ?? '').localeCompare(a.po.ARRIVAL_DATE ?? '') ||
            (b.po.LOT_NUMBER ?? '').localeCompare(a.po.LOT_NUMBER ?? ''),
        ),
        total: round2(rows.reduce((acc, r) => acc + r.balance, 0)),
        overdue: rows.some((r) => r.overdue),
      }))
      .sort((a, b) => a.growerName.localeCompare(b.growerName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrders, growers, customers, poDueDate, term]);

  const apGrowersTotal = round2(apGrowerGroups.reduce((acc, g) => acc + g.total, 0));

  /** Filas del grower elegido (o de todos), mas recientes arriba por Arrival Date. */
  const apGrowerRows = useMemo(() => {
    const groups = apGrower ? apGrowerGroups.filter((g) => g.growerId === apGrower) : apGrowerGroups;
    return groups
      .flatMap((g) => g.rows)
      .sort(
        (a, b) =>
          (b.po.ARRIVAL_DATE ?? '').localeCompare(a.po.ARRIVAL_DATE ?? '') ||
          (b.po.LOT_NUMBER ?? '').localeCompare(a.po.LOT_NUMBER ?? ''),
      );
  }, [apGrowerGroups, apGrower]);

  const selectApGrower = (growerId: string) => {
    setApGrower(growerId);
    setPage(1);
  };

  /** Check # del gasto; si no lo tiene, el de sus pagos (para que coincida con Payments). */
  const checkOf = useMemo(() => {
    const byExpense = new Map<string, string[]>();
    for (const p of billPayments) {
      if (!p.ID_EXPENSES || !p.CHECK_NUMBER) continue;
      byExpense.set(p.ID_EXPENSES, [...(byExpense.get(p.ID_EXPENSES) ?? []), p.CHECK_NUMBER]);
    }
    return (e: Expense): string => e.CHECK_NUMBER || [...new Set(byExpense.get(e.id) ?? [])].join(', ');
  }, [billPayments]);

  /* ---- 3. Accounts Payable: gastos con saldo pendiente (en cero salen de la lista) ---- */
  const apRows = useMemo(() => {
    const lotOf = new Map(purchaseOrders.map((po) => [po.id, po.LOT_NUMBER ?? '']));
    return expenses
      .map((e) => ({ e, lot: lotOf.get(e.ID_PURCHASEORDER) ?? '\u2014', ...expenseBalance(e) }))
      .filter((r) => r.balance > SETTLED)
      .filter((r) =>
        matches(r.lot, r.e.INVOICE_NUMBER ?? '', suppliers.nameOf(r.e.ID_SUPPLIERS), categories.nameOf(r.e.ID_CATEGORYBILL)),
      )
      .sort((a, b) => (a.e.DATE ?? '').localeCompare(b.e.DATE ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, purchaseOrders, expenseBalance, suppliers, categories, term]);

  const apTotal = round2(apRows.reduce((acc, r) => acc + r.balance, 0));

  /* ---- 4. Accounts Receivable: ventas con saldo pendiente (en cero salen de la lista) ---- */
  const arRows = useMemo(
    () =>
      salesOrders
        .filter((so) => so.STATUS !== 'Cancelled')
        .map((so) => ({ so, ...saleBalance(so), days: overdueDays(so.DUE_DATE ?? '') }))
        .filter((r) => r.balance > SETTLED)
        .filter((r) => matches(r.so.SALES_ORDER_NUMBER ?? '', customers.nameOf(r.so.ID_CUSTOMER), r.so.REF ?? ''))
        /* Mas antiguas arriba: lo que se va venciendo queda primero (en rojo). */
        .sort(
          (a, b) =>
            (a.so.DATE ?? '').localeCompare(b.so.DATE ?? '') ||
            (a.so.SALES_ORDER_NUMBER ?? '').localeCompare(b.so.SALES_ORDER_NUMBER ?? ''),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salesOrders, saleBalance, customers, term],
  );

  /* Cuentas pendientes sin el filtro de busqueda: base del estado de cuenta. */
  const arPendingAll = useMemo(
    () =>
      salesOrders
        .filter((so) => so.STATUS !== 'Cancelled')
        .map((so) => ({ so, balance: saleBalance(so).balance, days: overdueDays(so.DUE_DATE ?? '') }))
        .filter((r) => r.balance > SETTLED),
    [salesOrders, saleBalance],
  );
  const { company } = useCompany();
  const [statementOpen, setStatementOpen] = useState(false);

  /* Cliente seleccionado en el panel izquierdo ('' = All), como en AppSheet. */
  const [arCustomer, setArCustomer] = useState('');

  /** Clientes con saldo por cobrar, con su total y si tienen algo vencido. */
  const arGroups = useMemo(() => {
    const byCustomer = new Map<string, { total: number; overdue: boolean }>();
    for (const r of arRows) {
      const key = r.so.ID_CUSTOMER || '';
      const prev = byCustomer.get(key) ?? { total: 0, overdue: false };
      byCustomer.set(key, { total: round2(prev.total + r.balance), overdue: prev.overdue || (r.days ?? 0) < 0 });
    }
    return [...byCustomer.entries()]
      .map(([customerId, g]) => ({ customerId, customerName: customers.nameOf(customerId), ...g }))
      .sort((a, b) => a.customerName.localeCompare(b.customerName));
  }, [arRows, customers]);

  /** Filas del cliente elegido (o de todos). */
  const arVisibleRows = useMemo(
    () => (arCustomer ? arRows.filter((r) => (r.so.ID_CUSTOMER || '') === arCustomer) : arRows),
    [arRows, arCustomer],
  );

  const selectArCustomer = (customerId: string) => {
    setArCustomer(customerId);
    setPage(1);
  };

  const arGrandTotal = round2(arRows.reduce((acc, r) => acc + r.balance, 0));
  const arTotal = round2(arVisibleRows.reduce((acc, r) => acc + r.balance, 0));
  const arOverdue = arVisibleRows.filter((r) => (r.days ?? 0) < 0).length;

  /* Cobro directo desde AR (mismo panel de pagos que Sales Desk). */
  const [payingSale, setPayingSale] = useState<SalesOrder | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const handleSalePaid = async (so: SalesOrder, totalPaid: number) => {
    await updateDocument<SalesOrder>(COLLECTIONS.SALES_ORDER, so.id, {
      INCOMES: totalPaid,
      BALANCE: round2((so.TOTAL ?? 0) - totalPaid),
    });
  };

  /* ---- 5. Expenses: todos los gastos con estado y fecha de pago ---- */
  const expenseRows = useMemo(() => {
    const lotOf = new Map(purchaseOrders.map((po) => [po.id, po.LOT_NUMBER ?? '']));
    const lastPayment = new Map<string, string>();
    for (const pay of billPayments) {
      const prev = lastPayment.get(pay.ID_EXPENSES) ?? '';
      if ((pay.DATE ?? '') > prev) lastPayment.set(pay.ID_EXPENSES, pay.DATE ?? '');
    }
    return expenses
      .map((e) => {
        const { paid, balance } = expenseBalance(e);
        return {
          e,
          lot: lotOf.get(e.ID_PURCHASEORDER) ?? '\u2014',
          paidAmount: paid,
          balance,
          paid: balance <= SETTLED,
          paymentDate: lastPayment.get(e.id) ?? '',
        };
      })
      .filter((r) =>
        matches(r.lot, r.e.INVOICE_NUMBER ?? '', suppliers.nameOf(r.e.ID_SUPPLIERS), categories.nameOf(r.e.ID_CATEGORYBILL), r.paid ? 'paid' : 'pending'),
      )
      .sort((a, b) => (b.e.DATE ?? '').localeCompare(a.e.DATE ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, purchaseOrders, billPayments, expenseBalance, suppliers, categories, term]);

  const expensesTotal = round2(expenseRows.reduce((acc, r) => acc + (r.e.AMOUNT ?? 0), 0));
  const expensesPending = round2(expenseRows.reduce((acc, r) => acc + Math.max(r.balance, 0), 0));

  /* ---- Columnas configurables de AR y AP (Configurator > Report: ...) ---- */
  interface ReportColumn<R> {
    numeric?: boolean;
    render: (row: R) => ReactNode;
    excel: (row: R) => string | number;
  }

  type ArRow = (typeof arRows)[number];
  type ApRow = (typeof apRows)[number];

  const AR_COLUMNS: Record<string, ReportColumn<ArRow>> = {
    'Date': { render: (r) => <span className="reports__td-inner--muted">{fmtDate(r.so.DATE ?? '')}</span>, excel: (r) => fmtDate(r.so.DATE ?? '') },
    'Customer': { render: (r) => <span className="reports__td-inner--nowrap">{customers.nameOf(r.so.ID_CUSTOMER)}</span>, excel: (r) => customers.nameOf(r.so.ID_CUSTOMER) },
    '# Sales order': { render: (r) => <span className="reports__td-inner--mono">{r.so.SALES_ORDER_NUMBER || '\u2014'}</span>, excel: (r) => r.so.SALES_ORDER_NUMBER ?? '' },
    'Ref': { render: (r) => <span className="reports__td-inner--muted">{r.so.REF || '\u2014'}</span>, excel: (r) => r.so.REF ?? '' },
    'Total': { numeric: true, render: (r) => fmtMoney(r.so.TOTAL ?? 0), excel: (r) => r.so.TOTAL ?? 0 },
    'Balance': { numeric: true, render: (r) => <span className="reports__td-inner--bad">{fmtMoney(r.balance)}</span>, excel: (r) => r.balance },
    'Due date': { render: (r) => <span className="reports__td-inner--muted">{fmtDate(r.so.DUE_DATE ?? '')}</span>, excel: (r) => fmtDate(r.so.DUE_DATE ?? '') },
    'Overdue days': {
      numeric: true,
      render: (r) => (
        <span className="reports__overdue">
          {r.days !== null && r.days < 0 && <span className="reports__dot reports__dot--bad" />}
          {r.days !== null && r.days >= 0 && <span className="reports__dot reports__dot--ok" />}
          {r.days ?? '\u2014'}
        </span>
      ),
      excel: (r) => r.days ?? 0,
    },
    'Status': { render: (r) => <StatusBadge value={r.so.STATUS ?? 'Draft'} />, excel: (r) => r.so.STATUS ?? '' },
    'Salesperson': { render: (r) => buyerName(r.so.ID_USERS), excel: (r) => buyerName(r.so.ID_USERS) },
    'Buyer': { render: (r) => <span className="reports__td-inner--muted">{r.so.BUYER || '\u2014'}</span>, excel: (r) => r.so.BUYER ?? '' },
  };

  const AP_COLUMNS: Record<string, ReportColumn<ApRow>> = {
    'Date': { render: (r) => <span className="reports__td-inner--muted">{fmtDate(r.e.DATE ?? '')}</span>, excel: (r) => fmtDate(r.e.DATE ?? '') },
    '# Lot': { render: (r) => <span className="reports__td-inner--mono">{r.lot}</span>, excel: (r) => r.lot },
    'Invoice #': { render: (r) => r.e.INVOICE_NUMBER || '\u2014', excel: (r) => r.e.INVOICE_NUMBER ?? '' },
    'Supplier': { render: (r) => suppliers.nameOf(r.e.ID_SUPPLIERS), excel: (r) => suppliers.nameOf(r.e.ID_SUPPLIERS) },
    'Category': { render: (r) => <span className="reports__td-inner--muted">{categories.nameOf(r.e.ID_CATEGORYBILL)}</span>, excel: (r) => categories.nameOf(r.e.ID_CATEGORYBILL) },
    'Amount': { numeric: true, render: (r) => fmtMoney(r.e.AMOUNT ?? 0), excel: (r) => r.e.AMOUNT ?? 0 },
    'Pay amount': { numeric: true, render: (r) => fmtMoney(r.paid), excel: (r) => r.paid },
    'Balance': { numeric: true, render: (r) => <span className="reports__td-inner--bad">{fmtMoney(r.balance)}</span>, excel: (r) => r.balance },
    'Check #': { render: (r) => <span className="reports__td-inner--mono">{checkOf(r.e) || '\u2014'}</span>, excel: (r) => checkOf(r.e) },
    'Note': { render: (r) => <span className="reports__td-inner--muted">{r.e.NOTE || '\u2014'}</span>, excel: (r) => r.e.NOTE ?? '' },
  };

  const arFields = FORM_DEFS.find((f) => f.id === 'report-ar')?.fields ?? [];
  const apFields = FORM_DEFS.find((f) => f.id === 'report-ap')?.fields ?? [];
  /* "Pay amount" se muestra como "Amount paid" (la clave se conserva para no romper configuraciones guardadas). */
  const relabel = <F extends { label: string }>(f: F): F => (f.label === 'Pay amount' ? { ...f, label: 'Amount paid' } : f);
  const arVisible = fieldsFor('report-ar', arFields).filter((f) => !f.hidden && AR_COLUMNS[f.key]);
  const apVisible = fieldsFor('report-ap', apFields).filter((f) => !f.hidden && AP_COLUMNS[f.key]).map(relabel);

  const handleExport = () => {
    if (report === 'queue') {
      void exportReport('Invoice Queue', [
        { header: 'Date', values: queueRows.map((so) => fmtDate(so.DATE ?? '')) },
        { header: 'Customer', values: queueRows.map((so) => customers.nameOf(so.ID_CUSTOMER)) },
        { header: '# Sales Order', values: queueRows.map((so) => so.SALES_ORDER_NUMBER ?? '') },
        { header: 'Total', values: queueRows.map((so) => so.TOTAL ?? 0) },
        { header: 'Due Date', values: queueRows.map((so) => fmtDate(so.DUE_DATE ?? '')) },
        { header: 'Status', values: queueRows.map((so) => so.STATUS ?? '') },
        { header: 'Salesperson', values: queueRows.map((so) => buyerName(so.ID_USERS)) },
        { header: 'Buyer', values: queueRows.map((so) => so.BUYER ?? '') },
      ]);
    } else if (report === 'apgrowers') {
      const flat = apGrowerRows;
      void exportReport('AP Growers', [
        { header: 'Grower', values: flat.map((r) => r.growerName) },
        { header: 'Vendor', values: flat.map((r) => customers.nameOf(r.po.ID_CUSTOMER)) },
        { header: 'Lot #', values: flat.map((r) => r.po.LOT_NUMBER ?? '') },
        { header: '# Ref', values: flat.map((r) => r.po.REF_NUMBER ?? '') },
        { header: 'Total', values: flat.map((r) => r.po.TOTAL ?? 0) },
        { header: 'Amount paid', values: flat.map((r) => r.po.AMOUNT_PAID ?? 0) },
        { header: 'Balance', values: flat.map((r) => r.balance) },
        { header: 'Arrival date', values: flat.map((r) => fmtDate(r.po.ARRIVAL_DATE ?? '')) },
        { header: 'Due date', values: flat.map((r) => fmtDate(r.dueDate)) },
        { header: 'Overdue', values: flat.map((r) => (r.overdue ? 'Yes' : 'No')) },
      ]);
    } else if (report === 'ap') {
      void exportReport('Accounts Payable', apVisible.map((f) => ({
        header: f.label,
        values: apRows.map((r) => AP_COLUMNS[f.key].excel(r)),
      })));
    } else if (report === 'ar') {
      void exportReport('Accounts Receivable', arVisible.map((f) => ({
        header: f.label,
        values: arVisibleRows.map((r) => AR_COLUMNS[f.key].excel(r)),
      })));
    } else {
      void exportReport('Expenses', [
        { header: 'Date', values: expenseRows.map((r) => fmtDate(r.e.DATE ?? '')) },
        { header: '# Lot', values: expenseRows.map((r) => r.lot) },
        { header: 'Supplier', values: expenseRows.map((r) => suppliers.nameOf(r.e.ID_SUPPLIERS)) },
        { header: 'Category', values: expenseRows.map((r) => categories.nameOf(r.e.ID_CATEGORYBILL)) },
        { header: 'Invoice #', values: expenseRows.map((r) => r.e.INVOICE_NUMBER ?? '') },
        { header: 'Amount', values: expenseRows.map((r) => r.e.AMOUNT ?? 0) },
        { header: 'Amount paid', values: expenseRows.map((r) => r.paidAmount) },
        { header: 'Balance', values: expenseRows.map((r) => r.balance) },
        { header: 'Payment date', values: expenseRows.map((r) => fmtDate(r.paymentDate)) },
        { header: 'Status', values: expenseRows.map((r) => (r.paid ? 'Paid' : 'Pending')) },
      ]);
    }
  };

  return (
    <div className="reports">
      <Toolbar
        title={REPORT_META[report].title}
        subtitle="Live financial report"
        searchValue={search}
        onSearchChange={setSearch}
      >
        {report === 'ar' && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setStatementOpen(true)}
            title="Download a customer statement (Aging by Customer) with its pending invoices"
          >
            Statement
          </button>
        )}
        {(report === 'ap' || report === 'ar' || report === 'apgrowers') && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setAuditOpen(true)}
            title="Compare every document with its payment records and fix what does not match"
          >
            Check payments
          </button>
        )}
        {can(REPORT_META[report].moduleId, 'documents') && (
          <button type="button" className="btn btn--secondary" onClick={handleExport}>
            Export Excel
          </button>
        )}
      </Toolbar>

      {report === 'queue' && (
        <>
          <div className="reports__chips">
            <span className="reports__chip">{queueRows.length} orders in queue</span>
            <span className="reports__chip">Total <b className="num">{fmtMoney(queueTotal)}</b></span>
          </div>
          <div className="reports__card">
            <table className="reports__table">
              <thead>
                <tr>
                  <th className="reports__th">Date</th>
                  <th className="reports__th">Customer</th>
                  <th className="reports__th"># Sales Order</th>
                  <th className="reports__th reports__th--num">Total</th>
                  <th className="reports__th">Due Date</th>
                  <th className="reports__th">Status</th>
                  <th className="reports__th">Salesperson</th>
                  <th className="reports__th">Buyer</th>
                </tr>
              </thead>
              <tbody>
                {queueRows.length === 0 && (
                  <tr><td className="reports__empty" colSpan={8}>No sales orders pending. All caught up.</td></tr>
                )}
                {paginate(queueRows).map((so) => (
                  <tr key={so.id} className="reports__row--click" onClick={() => setViewingSale(so)} title="Open sales order detail">
                    <td className="reports__td reports__td--muted">{fmtDate(so.DATE ?? '')}</td>
                    <td className="reports__td">{customers.nameOf(so.ID_CUSTOMER)}</td>
                    <td className="reports__td reports__td--mono">{so.SALES_ORDER_NUMBER || '\u2014'}</td>
                    <td className="reports__td reports__td--num">{fmtMoney(so.TOTAL ?? 0)}</td>
                    <td className="reports__td reports__td--muted">{fmtDate(so.DUE_DATE ?? '')}</td>
                    <td className="reports__td"><StatusBadge value={so.STATUS ?? 'Draft'} /></td>
                    <td className="reports__td">{buyerName(so.ID_USERS)}</td>
                    <td className="reports__td reports__td--muted">{so.BUYER || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagerFor(queueRows.length)}
        </>
      )}

      {report === 'apgrowers' && (
        <>
          <div className="reports__chips">
            <span className="reports__chip">Pending to pay <b className="num">{fmtMoney(apGrowersTotal)}</b></span>
            <span className="reports__chip">{apGrowerGroups.reduce((acc, g) => acc + g.rows.length, 0)} purchase orders</span>
            <span className="reports__chip">{apGrowerGroups.length} growers</span>
            {apGrowerRows.some((r) => r.overdue) && (
              <span className="reports__chip reports__chip--bad">
                {apGrowerRows.filter((r) => r.overdue).length} past due
              </span>
            )}
          </div>

          <div className="reports__ap">
            {/* Panel de growers con saldo pendiente (como el de AppSheet). */}
            <nav className="reports__ap-side" aria-label="Growers with pending balance">
              <button
                type="button"
                className={`reports__ap-item${apGrower === '' ? ' reports__ap-item--active' : ''}`}
                onClick={() => selectApGrower('')}
              >
                <span className="reports__ap-name">All</span>
                <span className="reports__ap-pill">{fmtMoney(apGrowersTotal)}</span>
              </button>
              {apGrowerGroups.map((group) => (
                <button
                  key={group.growerId}
                  type="button"
                  className={`reports__ap-item${apGrower === group.growerId ? ' reports__ap-item--active' : ''}${group.overdue ? ' reports__ap-item--overdue' : ''}`}
                  onClick={() => selectApGrower(group.growerId)}
                  title={group.overdue ? 'Has unpaid lots past their due date' : undefined}
                >
                  <span className="reports__ap-name">{group.growerName}</span>
                  <span className="reports__ap-pill">{fmtMoney(group.total)}</span>
                </button>
              ))}
            </nav>

            <div className="reports__ap-main">
              <div className="reports__card">
                <table className="reports__table">
                  <thead>
                    <tr>
                      <th className="reports__th">Grower</th>
                      <th className="reports__th">Vendor</th>
                      <th className="reports__th">Lot #</th>
                      <th className="reports__th"># Ref</th>
                      <th className="reports__th reports__th--num">Total</th>
                      <th className="reports__th reports__th--num">Amount paid</th>
                      <th className="reports__th reports__th--num">Balance</th>
                      <th className="reports__th">Arrival date</th>
                      <th className="reports__th">Due date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apGrowerRows.length === 0 && (
                      <tr><td className="reports__empty" colSpan={9}>Nothing pending to pay growers. All caught up.</td></tr>
                    )}
                    {paginate(apGrowerRows).map((r) => (
                      <tr
                        key={r.po.id}
                        className={`reports__row--click${r.overdue ? ' reports__row--overdue' : ''}`}
                        onClick={() => openPurchase(r.po.id)}
                        title={r.overdue ? 'Past due and not paid — open purchase order' : 'Open purchase order detail'}
                      >
                        <td className="reports__td">{r.growerName}</td>
                        <td className="reports__td">{customers.nameOf(r.po.ID_CUSTOMER)}</td>
                        <td className="reports__td reports__td--mono">{r.po.LOT_NUMBER}</td>
                        <td className="reports__td">{r.po.REF_NUMBER || '\u2014'}</td>
                        <td className="reports__td reports__td--num">{fmtMoney(r.po.TOTAL ?? 0)}</td>
                        <td className="reports__td reports__td--num">{fmtMoney(r.po.AMOUNT_PAID ?? 0)}</td>
                        <td className="reports__td reports__td--num">{fmtMoney(r.balance)}</td>
                        <td className="reports__td">{fmtDate(r.po.ARRIVAL_DATE ?? '')}</td>
                        <td className="reports__td">{fmtDate(r.dueDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pagerFor(apGrowerRows.length)}
            </div>
          </div>
        </>
      )}

      {report === 'ap' && (
        <>
          <div className="reports__chips">
            <span className="reports__chip">Pending <b className="num">{fmtMoney(apTotal)}</b></span>
            <span className="reports__chip">{apRows.length} invoices</span>
          </div>
          <div className="reports__card">
            <table className="reports__table">
              <thead>
                <tr>
                  {apVisible.map((f) => (
                    <th key={f.key} className={`reports__th${AP_COLUMNS[f.key].numeric ? ' reports__th--num' : ''}`}>{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apRows.length === 0 && (
                  <tr><td className="reports__empty" colSpan={Math.max(apVisible.length, 1)}>No pending bills. All caught up.</td></tr>
                )}
                {paginate(apRows).map((r) => (
                  <tr key={r.e.id} className="reports__row--click" onClick={() => openPurchase(r.e.ID_PURCHASEORDER)} title="Open purchase order detail">
                    {apVisible.map((f) => (
                      <td key={f.key} className={`reports__td${AP_COLUMNS[f.key].numeric ? ' reports__td--num' : ''}`}>{AP_COLUMNS[f.key].render(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagerFor(apRows.length)}
        </>
      )}

      {report === 'ar' && (
        <>
          <div className="reports__chips">
            <span className="reports__chip">Pending <b className="num">{fmtMoney(arTotal)}</b></span>
            <span className="reports__chip">{arVisibleRows.length} orders</span>
            <span className={`reports__chip${arOverdue > 0 ? ' reports__chip--bad' : ''}`}>{arOverdue} overdue</span>
          </div>

          <div className="reports__ap">
            {/* Panel de clientes con saldo por cobrar (como el de AppSheet). */}
            <nav className="reports__ap-side" aria-label="Customers with pending balance">
              <button
                type="button"
                className={`reports__ap-item${arCustomer === '' ? ' reports__ap-item--active' : ''}`}
                onClick={() => selectArCustomer('')}
              >
                <span className="reports__ap-name">All</span>
                <span className="reports__ap-pill">{fmtMoney(arGrandTotal)}</span>
              </button>
              {arGroups.map((group) => (
                <button
                  key={group.customerId}
                  type="button"
                  className={`reports__ap-item${arCustomer === group.customerId ? ' reports__ap-item--active' : ''}${group.overdue ? ' reports__ap-item--overdue' : ''}`}
                  onClick={() => selectArCustomer(group.customerId)}
                  title={group.overdue ? 'Has overdue orders' : undefined}
                >
                  <span className="reports__ap-name">{group.customerName}</span>
                  <span className="reports__ap-pill">{fmtMoney(group.total)}</span>
                </button>
              ))}
            </nav>

            <div className="reports__ap-main">
              <div className="reports__card">
                <table className="reports__table">
                  <thead>
                    <tr>
                      <th className="reports__th reports__th--pay" aria-label="Receive payment" />
                      {arVisible.map((f) => (
                        <th key={f.key} className={`reports__th${AR_COLUMNS[f.key].numeric ? ' reports__th--num' : ''}`}>{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {arVisibleRows.length === 0 && (
                      <tr><td className="reports__empty" colSpan={arVisible.length + 1}>Nothing pending to collect. All caught up.</td></tr>
                    )}
                    {paginate(arVisibleRows).map((r) => (
                      <tr
                        key={r.so.id}
                        className={`reports__row--click${(r.days ?? 0) < 0 ? ' reports__row--overdue' : ''}`}
                        onClick={() => setViewingSale(r.so)}
                        title={(r.days ?? 0) < 0 ? 'Overdue — open sales order detail' : 'Open sales order detail'}
                      >
                        <td className="reports__td reports__td--pay">
                          <button
                            type="button"
                            className="btn btn--icon reports__pay-btn"
                            aria-label={`Receive payment for sales order ${r.so.SALES_ORDER_NUMBER ?? ''}`}
                            title="Receive payment"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPayingSale(r.so);
                            }}
                          >
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M12 2v20M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2 2.7 5 3.4 5 1.5 5 3.6-2.2 3-5 3-5-1.1-5-3" />
                            </svg>
                          </button>
                        </td>
                        {arVisible.map((f) => (
                          <td key={f.key} className={`reports__td${AR_COLUMNS[f.key].numeric ? ' reports__td--num' : ''}`}>{AR_COLUMNS[f.key].render(r)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pagerFor(arVisibleRows.length)}
            </div>
          </div>

          {payingSale && (
            <Modal
              title={`Payments — Sales order ${payingSale.SALES_ORDER_NUMBER}`}
              open
              onClose={() => setPayingSale(null)}
              wide
            >
              <PaymentsPanel
                moduleId="sales"
                collectionName={COLLECTIONS.PAYMENT_SALES}
                parentField="ID_SALESORDER"
                parentId={payingSale.id}
                expectedTotal={payingSale.TOTAL ?? 0}
                onTotalPaidChange={(totalPaid) => handleSalePaid(payingSale, totalPaid)}
              />
            </Modal>
          )}
        </>
      )}

      {report === 'expenses' && (
        <>
          <div className="reports__chips">
            <span className="reports__chip">Total <b className="num">{fmtMoney(expensesTotal)}</b></span>
            <span className={`reports__chip${expensesPending > 0 ? ' reports__chip--bad' : ''}`}>
              Pending <b className="num">{fmtMoney(expensesPending)}</b>
            </span>
            <span className="reports__chip">{expenseRows.length} records</span>
          </div>
          <div className="reports__card">
            <table className="reports__table">
              <thead>
                <tr>
                  <th className="reports__th">Date</th>
                  <th className="reports__th"># Lot</th>
                  <th className="reports__th">Supplier</th>
                  <th className="reports__th">Category</th>
                  <th className="reports__th">Invoice #</th>
                  <th className="reports__th reports__th--num">Amount</th>
                  <th className="reports__th reports__th--num">Amount paid</th>
                  <th className="reports__th reports__th--num">Balance</th>
                  <th className="reports__th">Payment date</th>
                  <th className="reports__th">Status</th>
                </tr>
              </thead>
              <tbody>
                {expenseRows.length === 0 && (
                  <tr><td className="reports__empty" colSpan={10}>No expenses recorded.</td></tr>
                )}
                {paginate(expenseRows).map((r) => (
                  <tr key={r.e.id} className="reports__row--click" onClick={() => openPurchase(r.e.ID_PURCHASEORDER)} title="Open purchase order detail">
                    <td className="reports__td reports__td--muted">{fmtDate(r.e.DATE ?? '')}</td>
                    <td className="reports__td reports__td--mono">{r.lot}</td>
                    <td className="reports__td">{suppliers.nameOf(r.e.ID_SUPPLIERS)}</td>
                    <td className="reports__td reports__td--muted">{categories.nameOf(r.e.ID_CATEGORYBILL)}</td>
                    <td className="reports__td">{r.e.INVOICE_NUMBER || '\u2014'}</td>
                    <td className="reports__td reports__td--num">{fmtMoney(r.e.AMOUNT ?? 0)}</td>
                    <td className="reports__td reports__td--num">{fmtMoney(r.paidAmount)}</td>
                    <td className="reports__td reports__td--num">{fmtMoney(r.balance)}</td>
                    <td className="reports__td reports__td--muted">{fmtDate(r.paymentDate)}</td>
                    <td className="reports__td">
                      <span className={`reports__status reports__status--${r.paid ? 'paid' : 'pending'}`}>
                        {r.paid ? 'Paid' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagerFor(expenseRows.length)}
        </>
      )}

      {viewingSale && (
        <SalesOrderDetailPanel
          order={viewingSale}
          purchaseOrders={purchaseOrders}
          buyerName={buyerName}
          onClose={() => setViewingSale(null)}
        />
      )}

      {viewingPurchase && (
        <PurchaseOrderDetailPanel
          order={viewingPurchase}
          buyerName={buyerName}
          onClose={() => setViewingPurchase(null)}
        />
      )}
      {statementOpen && (
        <CustomerStatementModal
          company={company}
          pending={arPendingAll}
          defaultCustomerId={arCustomer}
          customerName={customers.nameOf}
          onClose={() => setStatementOpen(false)}
        />
      )}
      {auditOpen && (
        <PaymentsAuditPanel
          initialArea={report === 'ar' ? 'sales' : report === 'apgrowers' ? 'lots' : 'expenses'}
          onClose={() => setAuditOpen(false)}
        />
      )}
    </div>
  );
}
