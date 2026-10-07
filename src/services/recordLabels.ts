/**
 * Nombres legibles para el historial y la papelera: que modulo es cada coleccion
 * y como se llama cada registro (numero de orden, lote, nombre, correo...),
 * en vez de mostrar el id interno de Firestore.
 */
import { COLLECTIONS } from '../types/models';

const MODULE_LABELS: Record<string, string> = {
  [COLLECTIONS.PURCHASE_ORDER]: 'Purchase Orders',
  [COLLECTIONS.PURCHASE_DETAILS]: 'Purchase Order lines',
  [COLLECTIONS.SALES_ORDER]: 'Sales Desk',
  [COLLECTIONS.SALES_ORDER_DETAIL]: 'Sales Desk lines',
  [COLLECTIONS.EXPENSES]: 'Expenses',
  [COLLECTIONS.PAYMENT_SALES]: 'Sales payments',
  [COLLECTIONS.PAYMENT_PURCHASE]: 'Purchase payments',
  [COLLECTIONS.PAYMENT_BILL]: 'Expense payments',
  [COLLECTIONS.CUSTOMER]: 'Customers',
  [COLLECTIONS.USERS]: 'Users (catalog)',
  [COLLECTIONS.CATEGORY_BILL]: 'Bill categories',
  [COLLECTIONS.GROWER]: 'Growers',
  [COLLECTIONS.CARRIER]: 'Carriers',
  [COLLECTIONS.LOCATIONS]: 'Locations',
  [COLLECTIONS.COMMODITIES]: 'Commodities',
  [COLLECTIONS.SUPPLIERS]: 'Suppliers',
  [COLLECTIONS.SHIPVIA]: 'Ship via',
  [COLLECTIONS.TERMSHIPPING]: 'Shipping terms',
  [COLLECTIONS.PAYMENT_METHOD]: 'Payment methods',
  [COLLECTIONS.PAYMENTTERM]: 'Payment terms',
  [COLLECTIONS.SYSTEM_USERS]: 'System Users',
  [COLLECTIONS.ROLES]: 'Roles',
  [COLLECTIONS.APP_SETTINGS]: 'Configurator',
  [COLLECTIONS.CHECKS]: 'Checkbook',
  [COLLECTIONS.CHECK_ACCOUNTS]: 'Checking Set-Up',
  [COLLECTIONS.EMAIL_RECIPIENTS]: 'Email recipients',
  [COLLECTIONS.EMAIL_TEMPLATES]: 'Email messages',
  [COLLECTIONS.EMAIL_BUNDLES]: 'Combined emails',
  [COLLECTIONS.EMAIL_LOG]: 'Sent emails',
  [COLLECTIONS.COMPANY]: 'Company Info',
  [COLLECTIONS.COMPANIES]: 'Companies',
};

export const moduleLabel = (collection: string): string => MODULE_LABELS[collection] ?? collection;

/** Campos que identifican un registro, en orden de preferencia. */
const KEY_FIELDS = [
  'SALES_ORDER_NUMBER',
  'LOT_NUMBER',
  'CHECK_NUMBER',
  'INVOICE_NUMBER',
  'REF_NUMBER',
  'NAME',
  'EMAIL',
  'email',
  'name',
  'DOC_LABEL',
];

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';

const money = (value: unknown): string =>
  typeof value === 'number' ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';

/**
 * Nombre legible de un registro a partir de sus datos. Vacio si no hay con que
 * nombrarlo (el que llama decide el respaldo).
 */
export function recordLabel(collection: string, data: Record<string, unknown> | null | undefined): string {
  if (!data) return '';
  /* Lineas: producto y cantidad (el numero de la orden lo agrega quien lo conoce). */
  if (collection === COLLECTIONS.SALES_ORDER_DETAIL || collection === COLLECTIONS.PURCHASE_DETAILS) {
    const desc = text(data.DESCRIPTION);
    const qty = text(data.QUANTITY);
    return [desc, qty && `${qty} units`].filter(Boolean).join(' · ');
  }
  /* Pagos: monto y fecha. */
  if (
    collection === COLLECTIONS.PAYMENT_SALES ||
    collection === COLLECTIONS.PAYMENT_PURCHASE ||
    collection === COLLECTIONS.PAYMENT_BILL
  ) {
    return [money(data.AMOUNT), text(data.DATE)].filter(Boolean).join(' · ');
  }
  if (collection === COLLECTIONS.SYSTEM_USERS) {
    const name = `${text(data.firstName)} ${text(data.lastName)}`.trim();
    return name || text(data.email);
  }
  if (collection === COLLECTIONS.EXPENSES) {
    return [text(data.INVOICE_NUMBER), money(data.AMOUNT)].filter(Boolean).join(' · ');
  }
  for (const key of KEY_FIELDS) {
    const value = text(data[key]);
    if (value) return value;
  }
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('NAME') && text(value)) return text(value);
  }
  return '';
}
