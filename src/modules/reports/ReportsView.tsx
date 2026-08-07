import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { Toolbar } from '../../components/ui/Toolbar';
import { fmtMoney, round2, todayISO } from '../../utils/format';
import {
  COLLECTIONS,
  type Expense,
  type PaymentBill,
  type PurchaseOrder,
  type SalesOrder,
} from '../../types/models';
import './ReportsView.css';

type ReportId = 'queue' | 'ap' | 'ar' | 'expenses';

const REPORTS: { id: ReportId; label: string }[] = [
  { id: 'queue', label: 'Invoice Queue' },
  { id: 'ap', label: 'Accounts Payable' },
  { id: 'ar', label: 'Accounts Receivable' },
  { id: 'expenses', label: 'Expenses' },
];

const fmtDate = (iso: string): string => {
  if (!iso) return '—';
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

export function ReportsView() {
  const { can } = useAuth();
  const [report, setReport] = useState<ReportId>('queue');
  const [search, setSearch] = useState('');

  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const { data: salesOrders } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: expenses } = useCollection<Expense>(COLLECTIONS.EXPENSES);
  const { data: billPayments } = useCollection<PaymentBill>(COLLECTIONS.PAYMENT_BILL);
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const categories = useCatalog(COLLECTIONS.CATEGORY_BILL, 'NAME');

  const term = search.trim().toLowerCase();
  const matches = (...values: string[]): boolean =>
    !term || values.some((v) => v.toLowerCase().includes(term));

  /* ---- 1. Invoice Queue: POs con saldo pendiente, agrupadas por grower ---- */
  const queueGroups = useMemo(() => {
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

  const queueTotal = round2(queueGroups.reduce((acc, g) => acc + g.total, 0));

  /* ---- 2. Accounts Payable: gastos con saldo pendiente ---- */
  const apRows = useMemo(() => {
    const lotOf = new Map(purchaseOrders.map((po) => [po.id, po.LOT_NUMBER ?? '']));
    return expenses
      .filter((e) => round2(e.BALANCE ?? 0) > 0)
      .map((e) => ({ e, lot: lotOf.get(e.ID_PURCHASEORDER) ?? '—' }))
      .filter((r) =>
        matches(r.lot, r.e.INVOICE_NUMBER ?? '', suppliers.nameOf(r.e.ID_SUPPLIERS), categories.nameOf(r.e.ID_CATEGORYBILL)),
      )
      .sort((a, b) => (a.e.DATE ?? '').localeCompare(b.e.DATE ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, purchaseOrders, suppliers, categories, term]);

  const apTotal = round2(apRows.reduce((acc, r) => acc + (r.e.BALANCE ?? 0), 0));

  /* ---- 3. Accounts Receivable: ventas con saldo pendiente ---- */
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

  /* ---- 4. Expenses: todos los gastos con estado y fecha de pago ---- */
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
        lot: lotOf.get(e.ID_PURCHASEORDER) ?? '—',
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

  const handleExport = () => {
    if (report === 'queue') {
      const flat = queueGroups.flatMap((g) => g.rows.map((r) => ({ g, r })));
      void exportReport('Invoice Queue', [
        { header: 'Grower', values: flat.map(({ g }) => g.growerName) },
        { header: 'Vendor', values: flat.map(({ r }) => customers.nameOf(r.po.ID_CUSTOMER)) },
        { header: 'Lot #', values: flat.map(({ r }) => r.po.LOT_NUMBER ?? '') },
        { header: '# Ref', values: flat.map(({ r }) => r.po.REF_NUMBER ?? '') },
        { header: 'Amount paid', values: flat.map(({ r }) => r.po.AMOUNT_PAID ?? 0) },
        { header: 'Balance', values: flat.map(({ r }) => r.balance) },
        { header: 'Arrival date', values: flat.map(({ r }) => fmtDate(r.po.ARRIVAL_DATE ?? '')) },
      ]);
    } else if (report === 'ap') {
      void exportReport('Accounts Payable', [
        { header: '# Lot', values: apRows.map((r) => r.lot) },
        { header: 'Invoice #', values: apRows.map((r) => r.e.INVOICE_NUMBER ?? '') },
        { header: 'Date', values: apRows.map((r) => fmtDate(r.e.DATE ?? '')) },
        { header: 'Supplier', values: apRows.map((r) => suppliers.nameOf(r.e.ID_SUPPLIERS)) },
        { header: 'Category', values: apRows.map((r) => categories.nameOf(r.e.ID_CATEGORYBILL)) },
        { header: 'Amount', values: apRows.map((r) => r.e.AMOUNT ?? 0) },
        { header: 'Pay amount', values: apRows.map((r) => r.e.PAY_AMOUNT ?? 0) },
        { header: 'Balance', values: apRows.map((r) => r.e.BALANCE ?? 0) },
      ]);
    } else if (report === 'ar') {
      void exportReport('Accounts Receivable', [
        { header: '# Sales order', values: arRows.map((r) => r.so.SALES_ORDER_NUMBER ?? '') },
        { header: 'Customer', values: arRows.map((r) => customers.nameOf(r.so.ID_CUSTOMER)) },
        { header: 'Ref', values: arRows.map((r) => r.so.REF ?? '') },
        { header: 'Total', values: arRows.map((r) => r.so.TOTAL ?? 0) },
        { header: 'Balance', values: arRows.map((r) => r.balance) },
        { header: 'Date', values: arRows.map((r) => fmtDate(r.so.DATE ?? '')) },
        { header: 'Due date', values: arRows.map((r) => fmtDate(r.so.DUE_DATE ?? '')) },
        { header: 'Overdue days', values: arRows.map((r) => r.days ?? 0) },
      ]);
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
      <Toolbar title="Reports" subtitle="Live financial reports" searchValue={search} onSearchChange={setSearch}>
        {can('reports', 'documents') && (
          <button type="button" className="btn btn--secondary" onClick={handleExport}>
            Export Excel
          </button>
        )}
      </Toolbar>

      <div className="reports__tabs">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`reports__tab${report === r.id ? ' reports__tab--active' : ''}`}
            onClick={() => setReport(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {report === 'queue' && (
        <>
          <div className="reports__chips">
            <span className="reports__chip">Pending to pay <b className="num">{fmtMoney(queueTotal)}</b></span>
            <span className="reports__chip">{queueGroups.reduce((acc, g) => acc + g.rows.length, 0)} purchase orders</span>
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
                {queueGroups.length === 0 && (
                  <tr><td className="reports__empty" colSpan={6}>No pending purchase invoices. All caught up.</td></tr>
                )}
                {queueGroups.map((group) => (
                  [
                    <tr className="reports__group-row" key={`g-${group.growerId}`}>
                      <td className="reports__group-cell" colSpan={4}>{group.growerName}</td>
                      <td className="reports__group-cell reports__td--num">{fmtMoney(group.total)}</td>
                      <td className="reports__group-cell" />
                    </tr>,
                    ...group.rows.map((r) => (
                      <tr key={r.po.id}>
                        <td className="reports__td">{customers.nameOf(r.po.ID_CUSTOMER)}</td>
                        <td className="reports__td reports__td--mono">{r.po.LOT_NUMBER}</td>
                        <td className="reports__td reports__td--muted">{r.po.REF_NUMBER || '—'}</td>
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
                  <th className="reports__th"># Lot</th>
                  <th className="reports__th">Invoice #</th>
                  <th className="reports__th">Date</th>
                  <th className="reports__th">Supplier</th>
                  <th className="reports__th">Category</th>
                  <th className="reports__th reports__th--num">Amount</th>
                  <th className="reports__th reports__th--num">Pay amount</th>
                  <th className="reports__th reports__th--num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {apRows.length === 0 && (
                  <tr><td className="reports__empty" colSpan={8}>No pending bills. All caught up.</td></tr>
                )}
                {apRows.map((r) => (
                  <tr key={r.e.id}>
                    <td className="reports__td reports__td--mono">{r.lot}</td>
                    <td className="reports__td">{r.e.INVOICE_NUMBER || '—'}</td>
                    <td className="reports__td reports__td--muted">{fmtDate(r.e.DATE ?? '')}</td>
                    <td className="reports__td">{suppliers.nameOf(r.e.ID_SUPPLIERS)}</td>
                    <td className="reports__td reports__td--muted">{categories.nameOf(r.e.ID_CATEGORYBILL)}</td>
                    <td className="reports__td reports__td--num">{fmtMoney(r.e.AMOUNT ?? 0)}</td>
                    <td className="reports__td reports__td--num">{fmtMoney(r.e.PAY_AMOUNT ?? 0)}</td>
                    <td className="reports__td reports__td--num reports__td--bad">{fmtMoney(r.e.BALANCE ?? 0)}</td>
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
                  <th className="reports__th"># Sales order</th>
                  <th className="reports__th">Customer</th>
                  <th className="reports__th">Ref</th>
                  <th className="reports__th reports__th--num">Total</th>
                  <th className="reports__th reports__th--num">Balance</th>
                  <th className="reports__th">Date</th>
                  <th className="reports__th">Due date</th>
                  <th className="reports__th reports__th--num">Overdue days</th>
                </tr>
              </thead>
              <tbody>
                {arRows.length === 0 && (
                  <tr><td className="reports__empty" colSpan={8}>Nothing pending to collect. All caught up.</td></tr>
                )}
                {arRows.map((r) => (
                  <tr key={r.so.id}>
                    <td className="reports__td reports__td--mono">{r.so.SALES_ORDER_NUMBER}</td>
                    <td className="reports__td">{customers.nameOf(r.so.ID_CUSTOMER)}</td>
                    <td className="reports__td reports__td--muted">{r.so.REF || '—'}</td>
                    <td className="reports__td reports__td--num">{fmtMoney(r.so.TOTAL ?? 0)}</td>
                    <td className="reports__td reports__td--num reports__td--bad">{fmtMoney(r.balance)}</td>
                    <td className="reports__td reports__td--muted">{fmtDate(r.so.DATE ?? '')}</td>
                    <td className="reports__td reports__td--muted">{fmtDate(r.so.DUE_DATE ?? '')}</td>
                    <td className="reports__td reports__td--num">
                      <span className="reports__overdue">
                        {r.days !== null && r.days < 0 && <span className="reports__dot reports__dot--bad" />}
                        {r.days !== null && r.days >= 0 && <span className="reports__dot reports__dot--ok" />}
                        {r.days ?? '—'}
                      </span>
                    </td>
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
                  <tr key={r.e.id}>
                    <td className="reports__td reports__td--muted">{fmtDate(r.e.DATE ?? '')}</td>
                    <td className="reports__td reports__td--mono">{r.lot}</td>
                    <td className="reports__td">{suppliers.nameOf(r.e.ID_SUPPLIERS)}</td>
                    <td className="reports__td reports__td--muted">{categories.nameOf(r.e.ID_CATEGORYBILL)}</td>
                    <td className="reports__td">{r.e.INVOICE_NUMBER || '—'}</td>
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
    </div>
  );
}
