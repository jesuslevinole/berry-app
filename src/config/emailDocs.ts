import type { CustomerEmailTarget, EmailBundle, EmailDocType, EmailKey, SalesDocType } from '../types/models';

/** Documentos que se envian por correo, en el orden en que se muestran. */
export const EMAIL_DOC_TYPES: { id: EmailDocType; label: string }[] = [
  { id: 'invoice', label: 'Invoice' },
  { id: 'pick', label: 'Pick Ticket' },
  { id: 'so', label: 'Sales Order' },
  { id: 'bol', label: 'Bill of Lading' },
  { id: 'po', label: 'Purchase Order' },
  { id: 'statement', label: 'Statement' },
];

/** Documentos de la orden de venta que se pueden combinar en un mismo correo. */
export const SALES_DOC_TYPES: { id: SalesDocType; label: string; short: string }[] = [
  { id: 'invoice', label: 'Invoice', short: 'Invoice' },
  { id: 'pick', label: 'Pick Ticket', short: 'Pick Tix' },
  { id: 'so', label: 'Sales Order', short: 'Sales Order' },
  { id: 'bol', label: 'Bill of Lading', short: 'BOL' },
];

export const emailDocLabel = (id: EmailDocType): string => EMAIL_DOC_TYPES.find((d) => d.id === id)?.label ?? id;

/* ---------------- Envios combinados (bundles) ---------------- */

export const bundleKey = (bundleId: string): EmailKey => `bundle_${bundleId}`;
export const isBundleKey = (key: EmailKey): key is `bundle_${string}` => key.startsWith('bundle_');

/** "Pick Ticket + Bill of Lading" */
export const bundleDocsLabel = (docs: SalesDocType[]): string =>
  SALES_DOC_TYPES.filter((d) => docs.includes(d.id))
    .map((d) => d.label)
    .join(' + ');

/** Todo lo que se puede enviar (documentos + combinados), con su nombre. */
export interface EmailTarget {
  key: EmailKey;
  label: string;
  /** Envio combinado (sus documentos). */
  bundle?: EmailBundle;
}

export const emailTargets = (bundles: EmailBundle[]): EmailTarget[] => [
  ...EMAIL_DOC_TYPES.map((d) => ({ key: d.id as EmailKey, label: d.label })),
  ...bundles.map((b) => ({ key: bundleKey(b.id), label: b.NAME || bundleDocsLabel(b.DOCS ?? []), bundle: b })),
];

/* ---------------- Correo del cliente ---------------- */

/** Opciones de envio al cliente (ademas de los correos de Email Settings). */
export const CUSTOMER_TARGETS: { id: CustomerEmailTarget; label: string }[] = [
  { id: 'none', label: 'Do not send to the customer' },
  { id: 'sales', label: 'Customer Sales Email' },
  { id: 'accounting', label: 'Customer Accounting Email' },
  { id: 'both', label: 'Both customer emails' },
];

export const targetFrom = (sales: boolean, accounting: boolean): CustomerEmailTarget =>
  sales && accounting ? 'both' : sales ? 'sales' : accounting ? 'accounting' : 'none';
