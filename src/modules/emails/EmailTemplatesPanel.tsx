import { useState } from 'react';
import { EmailTemplateFields } from '../../components/ui/EmailTemplateFields';
import { useEmailTemplates, type TemplateContent } from '../../hooks/useEmailTemplates';
import { defaultTemplate } from '../../services/emailTemplates';
import { CUSTOMER_TARGETS, bundleDocsLabel } from '../../config/emailDocs';
import { useEmailBundles } from '../../hooks/useEmailBundles';
import type { CustomerEmailTarget, EmailKey } from '../../types/models';
import './EmailTemplatesPanel.css';

interface Props {
  canEdit: boolean;
  /** Mensaje que se abre primero. */
  initialKey?: EmailKey;
}

/** Ejemplo para la vista previa (asi se ve el mensaje con datos reales). */
const SAMPLE: Record<string, string> = {
  number: '46117',
  customer: 'M&M West Coast Produce, Inc',
  ref: '65084',
  total: '$6,000.00',
  date: '9/16/2026',
  due_date: '10/1/2026',
  company: 'Berry Source, LC',
  count: '2',
  start_date: '4/1/2026',
  end_date: '9/28/2026',
  vendor: 'Gator Produce, LLC',
  grower: 'Rancho El Sol',
  documents: 'Pick Ticket & Bill of Lading',
};

/** Email Settings > Messages: asunto y mensaje guardados de cada documento. */
export function EmailTemplatesPanel({ canEdit, initialKey = 'invoice' }: Props) {
  const { templateFor, saveTemplate, saveCustomerTo, loading } = useEmailTemplates();
  const { targets } = useEmailBundles();
  const [doc, setDoc] = useState<EmailKey>(initialKey);
  const target = targets.find((t) => t.key === doc);
  const docLabel = target?.label ?? doc;
  /* Para el Purchase Order el "cliente" es el Vendor. */
  const partyLabel = doc === 'po' ? 'vendor' : 'customer';
  const [draft, setDraft] = useState<TemplateContent | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const saved = templateFor(doc);
  const content = draft ?? { subject: saved.subject, body: saved.body };
  const changed = !!draft && (draft.subject !== saved.subject || draft.body !== saved.body);

  const choose = (next: EmailKey) => {
    if (next === doc) return;
    if (changed && !window.confirm('Discard the changes to this message?')) return;
    setDoc(next);
    setDraft(null);
    setNotice('');
  };

  const update = (patch: Partial<TemplateContent>) => {
    setNotice('');
    setDraft({ ...content, ...patch });
  };

  const save = async () => {
    if (!content.subject.trim()) {
      alert('The subject is required.');
      return;
    }
    setBusy(true);
    try {
      await saveTemplate(doc, content);
      setDraft(null);
      setNotice(`${docLabel} message saved.`);
    } catch {
      alert('Could not save the message. Try again.');
    } finally {
      setBusy(false);
    }
  };

  /** A que correo del cliente se envia este documento (se guarda al momento). */
  const changeCustomerTo = async (value: CustomerEmailTarget) => {
    try {
      await saveCustomerTo(doc, value);
      setNotice(`${docLabel}: customer recipient saved.`);
    } catch {
      alert('Could not save the change. Try again.');
    }
  };

  const restore = () => {
    if (!window.confirm(`Replace the ${docLabel} message with the original template?`)) return;
    const d = defaultTemplate(doc);
    setDraft({ subject: d.subject, body: d.body });
    setVersion((v) => v + 1);
  };

  return (
    <div className="email-tpls">
      <nav className="email-tpls__list" aria-label="Documents">
        {targets.map((d) => {
          const isSaved = templateFor(d.key).saved;
          return (
            <button
              key={d.key}
              type="button"
              className={`email-tpls__item${doc === d.key ? ' email-tpls__item--active' : ''}`}
              onClick={() => choose(d.key)}
              title={d.bundle ? `Combined: ${bundleDocsLabel(d.bundle.DOCS)}` : undefined}
            >
              <span>{d.label}</span>
              <span className={`email-tpls__badge${isSaved ? ' email-tpls__badge--custom' : ''}`}>{isSaved ? 'Custom' : 'Original'}</span>
            </button>
          );
        })}
      </nav>

      <div className="email-tpls__editor">
        {loading ? (
          <p className="email-tpls__muted">Loading messages…</p>
        ) : (
          <>
            <p className="email-tpls__hint">
              This subject and message are used every time a <b>{docLabel}</b> is emailed. Use the buttons under the
              subject to insert data that changes per order; it is filled automatically when sending.
            </p>
            <label className="email-tpls__customer">
              <span className="email-tpls__customer-label">Also send to the {partyLabel}</span>
              <select
                className="input email-tpls__customer-select"
                value={saved.customerTo}
                disabled={!canEdit}
                onChange={(e) => void changeCustomerTo(e.target.value as CustomerEmailTarget)}
              >
                {CUSTOMER_TARGETS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="email-tpls__customer-help">
                Uses the Sales Email / Accounting Email of the {partyLabel} in Catalogs → Customers. It can be changed when sending.
              </span>
            </label>

            <EmailTemplateFields
              docType={doc}
              subject={content.subject}
              body={content.body}
              onSubjectChange={(subject) => update({ subject })}
              onBodyChange={(body) => update({ body })}
              editorKey={`${doc}-${version}`}
              previewValues={SAMPLE}
              disabled={!canEdit || busy}
            />
            {canEdit && (
              <div className="email-tpls__actions">
                <button type="button" className="send-email__link" disabled={busy} onClick={restore}>
                  Restore original
                </button>
                <button type="button" className="btn btn--primary" disabled={busy || !changed} onClick={() => void save()}>
                  {busy ? 'Saving…' : 'Save message'}
                </button>
              </div>
            )}
            {notice && <p className="send-email__notice">{notice}</p>}
          </>
        )}
      </div>
    </div>
  );
}
