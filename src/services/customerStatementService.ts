/**
 * Estado de cuenta del cliente ("Aging by Customer"), formato Berry Source / AppSheet:
 * hoja horizontal, logo + direccion, Aging Total, nombre del cliente en recuadro,
 * tabla de ordenes pendientes y el logo como marca de agua.
 * Se abre en una ventana lista para "Print / Save as PDF", igual que los demas documentos.
 */
import type { CompanyInfo } from '../types/models';

export interface StatementRow {
  salesOrder: string;
  date: string;
  customer: string;
  ref: string;
  total: number;
  balance: number;
  dueDate: string;
  /** Dias para el vencimiento: negativo = vencida (misma convencion que Accounts Receivable). */
  overdueDays: number | null;
}

export interface StatementInput {
  company: CompanyInfo;
  customerName: string;
  startDate: string;
  endDate: string;
  rows: StatementRow[];
}

const GREEN = '#2e7d32';

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const usd = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const slashDate = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}` : iso;
};

const todaySlash = (): string => {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
};

/** HTML completo del estado de cuenta (para imprimir y para adjuntarlo como PDF al correo). */
export function buildCustomerStatementHtml({ company, customerName, startDate, endDate, rows }: StatementInput): string {
  const agingTotal = rows.reduce((acc, r) => acc + r.balance, 0);
  const showBalance = rows.some((r) => Math.abs(r.total - r.balance) > 0.005);

  const body = rows
    .map(
      (r) => `
      <tr>
        <td>${esc(r.salesOrder)}</td>
        <td>${slashDate(r.date)}</td>
        <td>${esc(r.customer)}</td>
        <td>${esc(r.ref)}</td>
        <td>${usd(r.total)}</td>
        ${showBalance ? `<td>${usd(r.balance)}</td>` : ''}
        <td>${slashDate(r.dueDate)}</td>
        <td class="${r.overdueDays !== null && r.overdueDays < 0 ? 'late' : ''}">${r.overdueDays ?? ''}</td>
      </tr>`,
    )
    .join('');

  const period =
    startDate || endDate
      ? `<div class="period">${startDate ? slashDate(startDate) : 'Beginning'} &ndash; ${endDate ? slashDate(endDate) : todaySlash()}</div>`
      : '';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<title>Statement ${esc(customerName)}</title>
<style>
  @page { size: letter landscape; margin: 10mm 12mm; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c1c1c; background: #eef0f3; padding: 24px; font-size: 12px; }
  .page { position: relative; width: 1056px; max-width: 100%; min-height: 780px; margin: 0 auto; background: #ffffff; padding: 30px 40px 48px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.12); }
  .watermark { position: absolute; top: 56%; left: 50%; transform: translate(-50%, -50%); opacity: 0.12; pointer-events: none; }
  .watermark img { width: 400px; }
  .content { position: relative; }
  .printed { font-size: 10px; color: #555; margin-bottom: 6px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  .brand { display: flex; align-items: flex-start; gap: 12px; }
  .brand img { max-height: 54px; max-width: 120px; object-fit: contain; }
  .co-name { color: ${GREEN}; font-size: 19px; font-weight: 700; letter-spacing: 0.01em; }
  .co-addr { font-size: 11.5px; line-height: 1.35; color: #333; margin-top: 2px; }
  .aging { display: flex; align-items: baseline; gap: 12px; padding-top: 18px; font-size: 13px; }
  .aging b { font-size: 19px; border-bottom: 2px solid #1c1c1c; padding-bottom: 1px; }
  .title { text-align: center; margin-top: 28px; }
  .customer { display: inline-block; border: 1.5px solid #1c1c1c; padding: 8px 36px; font-size: 18px; font-weight: 700; min-width: 330px; }
  .subtitle { font-size: 14px; margin-top: 8px; }
  .period { font-size: 11.5px; color: #555; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 26px; }
  th { font-size: 12px; font-weight: 700; padding: 6px 8px; border-bottom: 1.5px solid #1c1c1c; text-align: center; }
  td { font-size: 12px; padding: 6px 8px; text-align: center; }
  td.late { color: #b03a2e; font-weight: 700; }
  tfoot td { border-top: 1px solid #1c1c1c; font-weight: 700; padding-top: 8px; }
  .empty { text-align: center; padding: 30px; color: #777; }
  .print-bar { text-align: center; margin: 0 0 18px; }
  .print-bar button { background: #1f7a4d; color: #ffffff; border: none; padding: 10px 26px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .print-bar span { display: block; margin-top: 6px; font-size: 12px; color: #555; }
  @media print {
    /* Imprimir los fondos (bandas verdes, etiquetas blancas) igual que en pantalla. */
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { background: #ffffff; padding: 0; }
    .print-bar { display: none; }
    /* Alto de la hoja (carta horizontal menos margenes): la marca de agua queda centrada en la pagina. */
    .page { box-shadow: none; width: auto; min-height: 186mm; padding: 6px 4px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style></head><body>
<div class="print-bar">
  <button onclick="window.print()">Print / Save as PDF</button>
  <span>Choose &ldquo;Save as PDF&rdquo; as the printer. The page is set to landscape.</span>
</div>
<div class="page">
  ${company.logo ? `<div class="watermark"><img src="${company.logo}" alt="" /></div>` : ''}
  <div class="content">
    <div class="printed">${todaySlash()}</div>
    <div class="head">
      <div class="brand">
        ${company.logo ? `<img src="${company.logo}" alt="logo" />` : ''}
        <div>
          <div class="co-name">${esc((company.name || '').toUpperCase())}</div>
          <div class="co-addr">${esc(company.address || '')}<br />${esc(company.cityStateZip || '')}</div>
        </div>
      </div>
      <div class="aging">Aging Total: <b>${usd(agingTotal)}</b></div>
    </div>

    <div class="title">
      <div class="customer">${esc(customerName)}</div>
      <div class="subtitle">Aging by Customer</div>
      ${period}
    </div>

    <table>
      <thead>
        <tr>
          <th>Sales Order#</th><th>Date</th><th>Customer</th><th>Ref</th><th>Total</th>
          ${showBalance ? '<th>Balance</th>' : ''}
          <th>Due Date</th><th>Overdue Days</th>
        </tr>
      </thead>
      <tbody>
        ${body || `<tr><td class="empty" colspan="${showBalance ? 8 : 7}">No pending invoices in this period.</td></tr>`}
      </tbody>
      ${
        rows.length > 1
          ? `<tfoot><tr><td colspan="4"></td><td>${usd(rows.reduce((a, r) => a + r.total, 0))}</td>${
              showBalance ? `<td>${usd(agingTotal)}</td>` : ''
            }<td colspan="2"></td></tr></tfoot>`
          : ''
      }
    </table>
  </div>
</div>
</body></html>`;
}

export function printCustomerStatement(input: StatementInput): void {
  const html = buildCustomerStatementHtml(input);
  const win = window.open('', '_blank');
  if (!win) {
    alert('Your browser blocked the document window. Allow pop-ups for this site.');
    return;
  }
  win.document.write(html);
  win.document.close();
}
