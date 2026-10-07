import { useMemo } from 'react';
import { useCollection } from './useCollection';
import { COLLECTIONS, type EmailDocType, type EmailRecipient } from '../types/models';

/** Destinatarios autorizados (Email Settings), ordenados por nombre. */
export function useEmailRecipients() {
  const { data, loading } = useCollection<EmailRecipient>(COLLECTIONS.EMAIL_RECIPIENTS);
  const recipients = useMemo(
    () => [...data].sort((a, b) => (a.NAME || a.EMAIL || '').localeCompare(b.NAME || b.EMAIL || '')),
    [data],
  );
  const active = useMemo(() => recipients.filter((r) => r.ACTIVE !== false && !!r.EMAIL), [recipients]);
  /** Correos marcados por defecto para un documento. */
  const defaultsFor = useMemo(
    () => (doc: EmailDocType): string[] => active.filter((r) => (r.DOCS ?? []).includes(doc)).map((r) => r.EMAIL),
    [active],
  );
  return { recipients, active, defaultsFor, loading };
}
