import type { CustomerEmailTarget, EmailDocType } from '../types/models';

/** Documentos que se envian por correo, en el orden en que se muestran. */
export const EMAIL_DOC_TYPES: { id: EmailDocType; label: string }[] = [
  { id: 'invoice', label: 'Invoice' },
  { id: 'pick', label: 'Pick Ticket' },
  { id: 'so', label: 'Sales Order' },
  { id: 'bol', label: 'Bill of Lading' },
  { id: 'statement', label: 'Statement' },
];

export const emailDocLabel = (id: EmailDocType): string => EMAIL_DOC_TYPES.find((d) => d.id === id)?.label ?? id;

/** Opciones de envio al cliente (ademas de los correos de Email Settings). */
export const CUSTOMER_TARGETS: { id: CustomerEmailTarget; label: string }[] = [
  { id: 'none', label: 'Do not send to the customer' },
  { id: 'sales', label: 'Customer Sales Email' },
  { id: 'accounting', label: 'Customer Accounting Email' },
  { id: 'both', label: 'Both customer emails' },
];

export const targetFrom = (sales: boolean, accounting: boolean): CustomerEmailTarget =>
  sales && accounting ? 'both' : sales ? 'sales' : accounting ? 'accounting' : 'none';
