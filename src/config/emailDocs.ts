import type { EmailDocType } from '../types/models';

/** Documentos que se envian por correo, en el orden en que se muestran. */
export const EMAIL_DOC_TYPES: { id: EmailDocType; label: string }[] = [
  { id: 'invoice', label: 'Invoice' },
  { id: 'pick', label: 'Pick Ticket' },
  { id: 'so', label: 'Sales Order' },
  { id: 'bol', label: 'Bill of Lading' },
  { id: 'statement', label: 'Statement' },
];

export const emailDocLabel = (id: EmailDocType): string => EMAIL_DOC_TYPES.find((d) => d.id === id)?.label ?? id;
