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
import { fmtMoney, round2, todayISO } from '../../utils/format';
import {
  COLLECTIONS,
  type Expense,
  type PaymentBill,
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

const fmtDate = (iso: string): string => {
  if (!iso) return '\u2014';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}` : iso;
};

/** Dias contra vencimiento: negativo = vencido (como en AppSheet). */
const overdueDays = (dueDate: string): number | null => {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date(`${todayISO()}T00:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
};

interface ExportColumn {
  header: string;
  values: (string | number)[];
}

/** Exporta un reporte a Excel con encabezado de marca (sin dependencias extra). */
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

  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const { data: salesOrders } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: expenses } = useCollection<Expense>(COLLECTIONS.EXPENSES);
  const { data: billPayments } = useCollection<PaymentBill>(COLLECTIONS.PAYMENT_BILL);
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const categories = useCatalog(COLLECTIONS.CATEGORY_BILL, 'NAME');
  const legacyUsers = useCatalog(COLLECTIONS.USERS, 'EMAIL_USERS');
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

  /* Detalle abierto dentro de Reports (sin salir de la vista). */
  const [viewingSale, setViewingSale] = useState<SalesOrder | null>(null);
  const [viewingPurchase, setViewingPurchase] = useState<PurchaseOrder | null>(null);

  /** Abre el detalle del gasto o lote: su Purchase Order asociado. */
  const openPurchase = (purchaseOrderId?: string) => {
    const po = purchaseOrders.find((p) => p.id === purchaseOrderId);
    if (po) setViewingPurchase(po);
  };

  /* ---- 1. Invoice Queue: ordenes con Loaded despalomeado (pendientes de cargar) ---- */
  const queueRows = useMemo(
    () =>
      salesOrders
        .filter((so) => !so.LOADED && so.STATUS !== 'Cancelled')
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
  const apGrowerGroups = useMemo(() => {
    const pending = purchaseOrders
      .map((po) => ({ po, balance: round2(po.BALANCE ?? (po.TOTAL ?? 0) - (po.AMOUNT_PAID ?? 0)) }))
      .filter((r) => r.balance > 0)
      .filter((r) =>
        matches(growers.nameOf(r.po.ID_GROWER), customers.nameOf(r.po.ID_CUSTOMER), r.po.LOT_NUMBER ?? '', r.po.REF_NUMBER ?? ''),
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
        rows: rows.sort((a, b) => (b.po.LOT_NUMBER ?? '').localeCompare(a.po.LOT_NUMBER ?? '')),
        total: round2(rows.reduce((acc, r) => acc + r.balance, 0)),
      }))
      .sort((a, b) => a.growerName.localeCompare(b.growerName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrders, growers, customers, term]);

  const apGrowersTotal = round2(apGrowerGroups.reduce((acc, g) => acc + g.total, 0));

  /* ---- 3. Accounts Payable: gastos con saldo pendiente ---- */
  const apRows = useMemo(() => {
    const lotOf = new Map(purchaseOrders.map((po) => [po.id, po.LOT_NUMBER ?? '']));
    return expenses
      .filter((e) => round2(e.BALANCE ?? 0) > 0)
      .map((e) => ({ e, lot: lotOf.get(e.ID_PURCHASEORDER) ?? '\u2014' }))
      .filter((r) =>
        matches(r.lot, r.e.INVOICE_NUMBER ?? '', suppliers.nameOf(r.e.ID_SUPPLIERS), categories.nameOf(r.e.ID_CATEGORYBILL)),
      )
      .sort((a, b) => (a.e.DATE ?? '').localeCompare(b.e.DATE ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, purchaseOrders, suppliers, categories, term]);

  const apTotal = round2(apRows.reduce((acc, r) => acc + (r.e.BALANCE ?? 0), 0));

  /* ---- 4. Accounts Receivable: ventas con saldo pendiente ---- */
  const arRows = useMemo(
    () =>
      salesOrders
        .map((so) => ({ so, balance: round2(so.BALANCE ?? (so.TOTAL ?? 0) - (so.INCOMES ?? 0)), days: overdueDays(so.DUE_DATE ?? '') }))
        .filter((r) => r.balance > 0)
        .filter((r) => matches(r.so.SALES_ORDER_NUMBER ?? '', customers.nameOf(r.so.ID_CUSTOMER), r.so.REF ?? ''))
        .sort((a, b) => (a.days ?? 0) - (b.days ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salesOrders, customers, term],
  );

  const arTotal = round2(arRows.reduce((acc, r) => acc + r.balance, 0));
  const arOverdue = arRows.filter((r) => (r.days ?? 0) < 0).length;

  /* ---- 5. Expenses: todos los gastos con estado y fecha de pago ---- */
  const expenseRows = useMemo(() => {
    const lotOf = new Map(purchaseOrders.map((po) => [po.id, po.LOT_NUMBER ?? '']));
    const lastPayment = new Map<string, string>();
    for (const pay of billPayments) {
      const prev = lastPayment.get(pay.ID_EXPENSES) ?? '';
      if ((pay.DATE ?? '') > prev) lastPayment.set(pay.ID_EXPENSES, pay.DATE ?? '');
    }
    return expenses
      .map((e) => ({
        e,
        lot: lotOf.get(e.ID_PURCHASEORDER) ?? '\u2014',
        paid: round2(e.BALANCE ?? 0) <= 0,
        paymentDate: lastPayment.get(e.id) ?? '',
      }))
      .filter((r) =>
        matches(r.lot, r.e.INVOICE_NUMBER ?? '', suppliers.nameOf(r.e.ID_SUPPLIERS), categories.nameOf(r.e.ID_CATEGORYBILL), r.paid ? 'paid' : 'pending'),
      )
      .sort((a, b) => (b.e.DATE ?? '').localeCompare(a.e.DATE ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, purchaseOrders, billPayments, suppliers, categories, term]);

  const expensesTotal = round2(expenseRows.reduce((acc, r) => acc + (r.e.AMOUNT ?? 0), 0));
  const expensesPending = round2(expenseRows.reduce((acc, r) => acc + (r.e.BALANCE ?? 0), 0));

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
    'Customer': { render: (r) => customers.nameOf(r.so.ID_CUSTOMER), excel: (r) => customers.nameOf(r.so.ID_CUSTOMER) },
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
    'Pay amount': { numeric: true, render: (r) => fmtMoney(r.e.PAY_AMOUNT ?? 0), excel: (r) => r.e.PAY_AMOUNT ?? 0 },
    'Balance': { numeric: true, render: (r) => <span className="reports__td-inner--bad">{fmtMoney(r.e.BALANCE ?? 0)}</span>, excel: (r) => r.e.BALANCE ?? 0 },
    'Check #': { render: (r) => <span className="reports__td-inner--mono">{r.e.CHECK_NUMBER || '\u2014'}</span>, excel: (r) => r.e.CHECK_NUMBER ?? '' },
    'Note': { render: (r) => <span className="reports__td-inner--muted">{r.e.NOTE || '\u2014'}</span>, excel: (r) => r.e.NOTE ?? '' },
  };

  const arFields = FORM_DEFS.find((f) => f.id === 'report-ar')?.fields ?? [];
  const apFields = FORM_DEFS.find((f) => f.id === 'report-ap')?.fields ?? [];
  const arVisible = fieldsFor('report-ar', arFields).filter((f) => !f.hidden && AR_COLUMNS[f.key]);
  const apVisible = fieldsFor('report-ap', apFields).filter((f) => !f.hidden && AP_COLUMNS[f.key]);

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
      const flat = apGrowerGroups.flatMap((g) => g.rows.map((r) => ({ g, r })));
      void exportReport('AP Growers', [
        { header: 'Grower', values: flat.map(({ g }) => g.growerName) },
        { header: 'Vendor', values: flat.map(({ r }) => customers.nameOf(r.po.ID_CUSTOMER)) },
        { header: 'Lot #', values: flat.map(({ r }) => r.po.LOT_NUMBER ?? '') },
        { header: '# Ref', values: flat.map(({ r }) => r.po.REF_NUMBER ?? '') },
        { header: 'Amount paid', values: flat.map(({ r }) => r.po.AMOUNT_PAID ?? 0) },
        { header: 'Balance', values: flat.map(({ r }) => r.balance) },
        { header: 'Arrival date', values: flat.map(({ r }) => fmtDate(r.po.ARRIVAL_DATE ?? '')) },
      ]);
    } else if (report === 'ap') {
      void exportReport('Accounts Payable', apVisible.map((f) => ({
        header: f.label,
        values: apRows.map((r) => AP_COLUMNS[f.key].excel(r)),
      })));
    } else if (report === 'ar') {
      void exportReport('Accounts Receivable', arVisible.map((f) => ({
        header: f.label,
        values: arRows.map((r) => AR_COLUMNS[f.key].excel(r)),
      })));
    } else {
      void exportReport('Expenses', [
        { header: 'Date', values: expenseRows.map((r) => fmtDate(r.e.DATE ?? '')) },
        { header: '# Lot', values: expenseRows.map((r) => r.lot) },
        { header: 'Supplier', values: expenseRows.map((r) => suppliers.nameOf(r.e.ID_SUPPLIERS)) },
        { header: 'Category', values: expenseRows.map((r) => categories.nameOf(r.e.ID_CATEGORYBILL)) },
        { header: 'Invoice #', values: expenseRows.map((r) => r.e.INVOICE_NUMBER ?? '') },
        { header: 'Amount', values: expenseRows.map((r) => r.e.AMOUNT ?? 0) },
        { header: 'Pay amount', values: expenseRows.map((r) => r.e.PAY_AMOUNT ?? 0) },
        { header: 'Balance', values: expenseRows.map((r) => r.e.BALANCE ?? 0) },
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
                {queueRows.map((so) => (
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
        </>
      )}

      {report === 'apgrowers' && (
        <>
          <div className="reports__chips">
            <span className="reports__chip">Pending to pay <b className="num">{fmtMoney(apGrowersTotal)}</b></span>
            <span className="reports__chip">{apGrowerGroups.reduce((acc, g) => acc + g.rows.length, 0)} purchase orders</span>
            <span className="reports__chip">{apGrowerGroups.length} growers</span>
          </div>
          <div className="reports__card">
            <table className="reports__table">
              <thead>
                <tr>
                  <th className="reports__th">Vendor</th>
                  <th className="reports__th">Lot #</th>
                  <th className="reports__th"># Ref</th>
                  <th className="reports__th reports__th--num">Amount paid</th>
                  <th className="reports__th reports__th--num">Balance</th>
                  <th className="reports__th">Arrival date</th>
                </tr>
              </thead>
              <tbody>
                {apGrowerGroups.length === 0 && (
                  <tr><td className="reports__empty" colSpan={6}>Nothing pending to pay growers. All caught up.</td></tr>
                )}
                {apGrowerGroups.map((group) => (
                  [
                    <tr className="reports__group-row" key={`g-${group.growerId}`}>
                      <td className="reports__group-cell" colSpan={4}>{group.growerName}</td>
                      <td className="reports__group-cell reports__td--num">{fmtMoney(group.total)}</td>
                      <td className="reports__group-cell" />
                    </tr>,
                    ...group.rows.map((r) => (
                      <tr key={r.po.id} className="reports__row--click" onClick={() => openPurchase(r.po.id)} title="Open purchase order detail">
                        <td className="reports__td">{customers.nameOf(r.po.ID_CUSTOMER)}</td>
                        <td className="reports__td reports__td--mono">{r.po.LOT_NUMBER}</td>
                        <td className="reports__td reports__td--muted">{r.po.REF_NUMBER || '\u2014'}</td>
                        <td className="reports__td reports__td--num">{fmtMoney(r.po.AMOUNT_PAID ?? 0)}</td>
                        <td className="reports__td reports__td--num reports__td--bad">{fmtMoney(r.balance)}</td>
                        <td className="reports__td reports__td--muted">{fmtDate(r.po.ARRIVAL_DATE ?? '')}</td>
                      </tr>
                    )),
                  ]
                ))}
              </tbody>
            </table>
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
                {apRows.map((r) => (
                  <tr key={r.e.id} className="reports__row--click" onClick={() => openPurchase(r.e.ID_PURCHASEORDER)} title="Open purchase order detail">
                    {apVisible.map((f) => (
                      <td key={f.key} className={`reports__td${AP_COLUMNS[f.key].numeric ? ' reports__td--num' : ''}`}>{AP_COLUMNS[f.key].render(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {report === 'ar' && (
        <>
          <div className="reports__chips">
            <span className="reports__chip">Pending <b className="num">{fmtMoney(arTotal)}</b></span>
            <span className="reports__chip">{arRows.length} orders</span>
            <span className={`reports__chip${arOverdue > 0 ? ' reports__chip--bad' : ''}`}>{arOverdue} overdue</span>
          </div>
          <div className="reports__card">
            <table className="reports__table">
              <thead>
                <tr>
                  {arVisible.map((f) => (
                    <th key={f.key} className={`reports__th${AR_COLUMNS[f.key].numeric ? ' reports__th--num' : ''}`}>{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {arRows.length === 0 && (
                  <tr><td className="reports__empty" colSpan={Math.max(arVisible.length, 1)}>Nothing pending to collect. All caught up.</td></tr>
                )}
                {arRows.map((r) => (
                  <tr key={r.so.id} className="reports__row--click" onClick={() => setViewingSale(r.so)} title="Open sales order detail">
                    {arVisible.map((f) => (
                      <td key={f.key} className={`reports__td${AR_COLUMNS[f.key].numeric ? ' reports__td--num' : ''}`}>{AR_COLUMNS[f.key].render(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                  <th className="reports__th reports__th--num">Pay amount</th>
                  <th className="reports__th reports__th--num">Balance</th>
                  <th className="reports__th">Payment date</th>
                  <th className="reports__th">Status</th>
                </tr>
              </thead>
              <tbody>
                {expenseRows.length === 0 && (
                  <tr><td className="reports__empty" colSpan={10}>No expenses recorded.</td></tr>
                )}
                {expenseRows.map((r) => (
                  <tr key={r.e.id} className="reports__row--click" onClick={() => openPurchase(r.e.ID_PURCHASEORDER)} title="Open purchase order detail">
                    <td className="reports__td reports__td--muted">{fmtDate(r.e.DATE ?? '')}</td>
                    <td className="reports__td reports__td--mono">{r.lot}</td>
                    <td className="reports__td">{suppliers.nameOf(r.e.ID_SUPPLIERS)}</td>
                    <td className="reports__td reports__td--muted">{categories.nameOf(r.e.ID_CATEGORYBILL)}</td>
                    <td className="reports__td">{r.e.INVOICE_NUMBER || '\u2014'}</td>
                    <td className="reports__td reports__td--num">{fmtMoney(r.e.AMOUNT ?? 0)}</td>
                    <td className="reports__td reports__td--num">{fmtMoney(r.e.PAY_AMOUNT ?? 0)}</td>
                    <td className="reports__td reports__td--num">{fmtMoney(r.e.BALANCE ?? 0)}</td>
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
    </div>
  );
}
