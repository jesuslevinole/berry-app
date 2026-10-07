import { useMemo } from 'react';
import { useCollection } from './useCollection';
import { auth } from '../firebase/config';
import { setDocumentWithId } from '../services/firestore';
import { defaultTemplate, sanitizeEmailHtml } from '../services/emailTemplates';
import { COLLECTIONS, type CustomerEmailTarget, type EmailKey, type EmailTemplate } from '../types/models';

export interface TemplateContent {
  subject: string;
  body: string;
}

/** Plantillas guardadas por documento (asunto + mensaje). Sin guardar = plantilla inicial. */
export function useEmailTemplates() {
  const { data, loading } = useCollection<EmailTemplate>(COLLECTIONS.EMAIL_TEMPLATES);

  const byDoc = useMemo(() => new Map(data.map((t) => [t.id, t])), [data]);

  const templateFor = useMemo(
    () =>
      (doc: EmailKey): TemplateContent & { saved: boolean; customerTo: CustomerEmailTarget } => {
        const saved = byDoc.get(doc);
        const customerTo = saved?.CUSTOMER_TO ?? 'none';
        if (saved && (saved.SUBJECT || saved.BODY_HTML)) {
          return { subject: saved.SUBJECT ?? '', body: saved.BODY_HTML ?? '', saved: true, customerTo };
        }
        const d = defaultTemplate(doc);
        return { subject: d.subject, body: d.body, saved: false, customerTo };
      },
    [byDoc],
  );

  /** Guarda asunto y mensaje como predeterminados del documento. */
  const saveTemplate = async (doc: EmailKey, content: TemplateContent): Promise<void> => {
    await setDocumentWithId(COLLECTIONS.EMAIL_TEMPLATES, doc, {
      SUBJECT: content.subject.trim(),
      BODY_HTML: sanitizeEmailHtml(content.body),
      UPDATED_BY: auth.currentUser?.email ?? '',
    });
  };

  /** Guarda a que correo del cliente se envia este documento por defecto. */
  const saveCustomerTo = async (doc: EmailKey, customerTo: CustomerEmailTarget): Promise<void> => {
    await setDocumentWithId(COLLECTIONS.EMAIL_TEMPLATES, doc, { CUSTOMER_TO: customerTo });
  };

  return { templateFor, saveTemplate, saveCustomerTo, loading };
}
