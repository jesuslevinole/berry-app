/** Formularios configurables y sus campos por defecto (clave = etiqueta en codigo). */
export interface FormDef {
  id: string;
  label: string;
  fields: string[];
}

export const FORM_DEFS: FormDef[] = [
  {
    id: 'purchases',
    label: 'Purchase order form',
    fields: ['Lot #', 'Grower / Origin', 'Vendor', 'Ship to', 'Buyer', 'Note', 'Commission %', '# Ref', 'Carrier', 'Arrival date', 'Payment term'],
  },
  {
    id: 'sales',
    label: 'Sales order form',
    fields: ['# Sales order', 'Status', 'Date', 'Due date', 'Customer', 'Buyer', 'Salesperson', 'Ref', 'Ref pickup', 'Carrier', 'Warehouse', 'Warehouse address', 'Ship via', 'Shipping terms', 'Temp log', 'Special instructions'],
  },
  {
    id: 'expenses',
    label: 'Expense form',
    fields: ['# Lot (purchase order)', 'Supplier', 'Category', 'Invoice #', 'Date', 'Amount', 'Check #', 'Photo check (URL)', 'Deduct', 'Note'],
  },
  {
    id: 'report-ar',
    label: 'Report: Accounts Receivable',
    fields: ['Date', 'Customer', '# Sales order', 'Ref', 'Total', 'Balance', 'Due date', 'Overdue days', 'Status', 'Salesperson', 'Buyer'],
  },
  {
    id: 'report-ap',
    label: 'Report: Accounts Payable',
    fields: ['Date', '# Lot', 'Invoice #', 'Supplier', 'Category', 'Amount', 'Pay amount', 'Balance', 'Check #', 'Note'],
  },
];

/** true si la seccion del Configurator es de columnas de reporte (usa toggle Visible). */
export const isReportDef = (id: string): boolean => id.startsWith('report-');
