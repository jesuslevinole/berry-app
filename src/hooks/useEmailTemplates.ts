import { useMemo } from 'react';
import { useCollection } from './useCollection';
import { auth } from '../firebase/config';
import { setDocumentWithId } from '../services/firestore';
import { defaultTemplate, sanitizeEmailHtml } from '../services/emailTemplates';
import { COLLECTIONS, type EmailDocType, type EmailTemplate } from '../types/models';

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
      (doc: EmailDocType): TemplateContent & { saved: boolean } => {
        const saved = byDoc.get(doc);
        if (saved && (saved.SUBJECT || saved.BODY_HTML)) return { subject: saved.SUBJECT ?? '', body: saved.BODY_HTML ?? '', saved: true };
        const d = defaultTemplate(doc);
        return { subject: d.subject, body: d.body, saved: false };
      },
    [byDoc],
  );

  /** Guarda asunto y mensaje como predeterminados del documento. */
  const saveTemplate = async (doc: EmailDocType, content: TemplateContent): Promise<void> => {
    await setDocumentWithId(COLLECTIONS.EMAIL_TEMPLATES, doc, {
      SUBJECT: content.subject.trim(),
      BODY_HTML: sanitizeEmailHtml(content.body),
      UPDATED_BY: auth.currentUser?.email ?? '',
    });
  };

  return { templateFor, saveTemplate, loading };
}
