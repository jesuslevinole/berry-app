/**
 * Excel de ventas de Sales Desk, replica del "Filter Excel" de AppSheet:
 * hoja "Filter", encabezados en la fila 1 y una fila por orden de venta con
 * Date, # Invoice, Customer, Ref, Product, Quantity, Total, Sales person, Buyer.
 */
import { todayISO } from '../utils/format';

export interface SalesExcelRow {
  /** yyyy-mm-dd */
  date: string;
  invoice: string;
  customer: string;
  ref: string;
  product: string;
  quantity: number;
  total: number;
  salesPerson: string;
  buyer: string;
}

const HEADERS = ['Date', '# Invoice', 'Customer', 'Ref', 'Product', 'Quantity', 'Total', 'Sales person', 'Buyer'];
const WIDTHS = [14, 12, 32, 22, 34, 11, 14, 18, 18];

/** yyyy-mm-dd -> Date local (sin corrimiento de zona horaria). */
const toDate = (iso: string): Date | string => {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : iso;
};

export async function downloadSalesExcel(rows: SalesExcelRow[], fileLabel: string): Promise<void> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Filter', { views: [{ state: 'frozen', ySplit: 1 }] });

  const header = sheet.getRow(1);
  HEADERS.forEach((h, i) => {
    const cell = header.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Arial', size: 10, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  WIDTHS.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  rows.forEach((r, index) => {
    const row = sheet.getRow(index + 2);
    row.values = [r.date ? toDate(r.date) : '', r.invoice, r.customer, r.ref, r.product, r.quantity, r.total, r.salesPerson, r.buyer];
    row.font = { name: 'Arial', size: 10 };
    row.getCell(1).numFmt = 'mm/dd/yyyy';
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'center' };
    row.getCell(6).numFmt = '#,##0';
    row.getCell(6).alignment = { horizontal: 'center' };
    row.getCell(7).numFmt = '#,##0.00';
    row.getCell(7).alignment = { horizontal: 'center' };
  });

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sales-${fileLabel || todayISO()}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
