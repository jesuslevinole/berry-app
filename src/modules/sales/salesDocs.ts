import {
  buildBillOfLadingHtml,
  buildPassingHtml,
  buildPickTicketHtml,
  buildSalesInvoiceHtml,
  buildSalesOrderDocHtml,
  printBillOfLading,
  printPassing,
  printPickTicket,
  printSalesInvoice,
  printSalesOrderDoc,
  type SalesDocContext,
} from '../../services/salesDocumentsService';
import type { SalesDocType, SalesOrder } from '../../types/models';

/** Documento imprimible de una orden de venta: imprimir (run), HTML para el PDF del correo (build) y prefijo del archivo. */
export interface SalesDocDef {
  id: SalesDocType;
  label: string;
  description: string;
  file: string;
  run: (so: SalesOrder, ctx: SalesDocContext) => Promise<void>;
  build: (so: SalesOrder, ctx: SalesDocContext) => Promise<string>;
}

/* Los documentos de una orden de venta (Sales Desk e Invoice Queue). */
export const SALES_DOCS: SalesDocDef[] = [
  { id: 'invoice', label: 'Invoice', description: 'Customer invoice with PACA terms', file: 'Inv', run: printSalesInvoice, build: buildSalesInvoiceHtml },
  { id: 'pick', label: 'Pick Ticket', description: 'Warehouse picking list with lots and temp', file: 'T', run: printPickTicket, build: buildPickTicketHtml },
  { id: 'so', label: 'Sales Order', description: 'Order confirmation with pick up info', file: 'SO', run: printSalesOrderDoc, build: buildSalesOrderDocHtml },
  { id: 'passing', label: 'Passing', description: 'Load confirmation with warehouse and total', file: 'Passing', run: printPassing, build: buildPassingHtml },
  { id: 'bol', label: 'Bill of Lading', description: 'Straight BOL with carrier contract terms', file: 'Bol', run: printBillOfLading, build: buildBillOfLadingHtml },
];
