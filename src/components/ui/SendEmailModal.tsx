import { useState } from 'react';
import { Modal } from './Modal';
import { EmailTemplateFields } from './EmailTemplateFields';
import { useEmailRecipients } from '../../hooks/useEmailRecipients';
import { useEmailTemplates, type TemplateContent } from '../../hooks/useEmailTemplates';
import { parseEmails, sendEmail, type EmailAttachment, type RecipientResult } from '../../services/emailService';
import { useCollection } from '../../hooks/useCollection';
import { createDocumentLocalFirst } from '../../services/firestore';
import { auth } from '../../firebase/config';
import { defaultTemplate, fillTemplate, sanitizeEmailHtml, wrapEmailHtml } from '../../services/emailTemplates';
import { emailDocLabel, targetFrom } from '../../config/emailDocs';
import { COLLECTIONS, type EmailDocType } from '../../types/models';
import './SendEmailModal.css';

interface Props {
  /** Tipo de documento: decide destinatarios marcados y la plantilla guardada. */
  docType: EmailDocType;
  title: string;
  /** Referencia del documento para el historial (ej. "46117" o el nombre del cliente). */
  docRef: string;
  /** Cliente del documento: permite enviarlo tambien a su Sales Email / Accounting Email. */
  customerId?: string;
  /** Valores de las variables de la plantilla ({{customer}}, {{number}}...). */
  values: Record<string, string>;
  /** Nombre del archivo que se adjunta (se muestra antes de enviar). */
  attachmentName: string;
  /** Genera el adjunto al momento de enviar (PDF en base64). */
  buildAttachment: () => Promise<EmailAttachment>;
  onClose: () => void;
  onSent?: () => void;
}

/**
 * Envia un documento por correo. Destinatarios: solo los autorizados en Email Settings.
 * Asunto y mensaje: la plantilla guardada del documento; lo que se edite aqui se guarda
 * como la nueva plantilla de ese documento (para la proxima vez solo presionar Send).
 */
export function SendEmailModal({ docType, title, docRef, customerId, values, attachmentName, buildAttachment, onClose, onSent }: Props) {
  const { active, defaultsFor, loading: loadingRecipients } = useEmailRecipients();
  const { templateFor, saveTemplate, saveCustomerTo, loading: loadingTemplates } = useEmailTemplates();
  /* Correos del cliente (Catalogs > Customers). La consulta ya la comparte Sales Desk: no cuesta lecturas extra. */
  const { data: customerDocs } = useCollection<{
    id: string;
    NAME_CUSTOMER?: string;
    ACCOUNTING_EMAIL_CUSTOMER?: string;
    ACCOUNTING_EMAIL_TWO_CUSTOMER?: string;
  }>(COLLECTIONS.CUSTOMER);
  const customer = customerId ? customerDocs.find((c) => c.id === customerId) : undefined;
  const salesEmails = parseEmails(customer?.ACCOUNTING_EMAIL_CUSTOMER ?? '');
  const accountingEmails = parseEmails(customer?.ACCOUNTING_EMAIL_TWO_CUSTOMER ?? '');
  const label = emailDocLabel(docType);

  /* null = todavia no se ha tocado: se usan los valores guardados. */
  const [picked, setPicked] = useState<string[] | null>(null);
  const selected = picked ?? defaultsFor(docType);
  /* Envio al cliente: por defecto lo guardado para este documento. */
  const [customerPick, setCustomerPick] = useState<{ sales: boolean; accounting: boolean } | null>(null);
  const [draft, setDraft] = useState<TemplateContent | null>(null);
  const saved = templateFor(docType);
  const customerChoice = customerPick ?? {
    sales: saved.customerTo === 'sales' || saved.customerTo === 'both',
    accounting: saved.customerTo === 'accounting' || saved.customerTo === 'both',
  };
  const customerTarget = targetFrom(customerChoice.sales, customerChoice.accounting);
  const customerTargetChanged = !!customerPick && customerTarget !== saved.customerTo;
  /* Correos del cliente que se van a incluir. */
  const customerRecipients = customer
    ? [...(customerChoice.sales ? salesEmails : []), ...(customerChoice.accounting ? accountingEmails : [])]
    : [];
  /* Todos los destinatarios (sin repetir). */
  const allRecipients = [...new Map([...selected, ...customerRecipients].map((e) => [e.toLowerCase(), e])).values()];
  const isCustomerEmail = (email: string): boolean => customerRecipients.some((c) => c.toLowerCase() === email.toLowerCase());
  const content = draft ?? { subject: saved.subject, body: saved.body };
  const changed = !!draft && (draft.subject !== saved.subject || draft.body !== saved.body);
  const [editorVersion, setEditorVersion] = useState(0);

  const [remember, setRemember] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'building' | 'sending'>('idle');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  /* Resultado por destinatario despues de enviar. */
  const [results, setResults] = useState<RecipientResult[] | null>(null);
  const busy = status !== 'idle';
  const allEmails = active.map((r) => r.EMAIL);
  const allSelected = allEmails.length > 0 && allEmails.every((e) => selected.includes(e));

  const toggle = (email: string) =>
    setPicked(selected.includes(email) ? selected.filter((e) => e !== email) : [...selected, email]);

  const update = (patch: Partial<TemplateContent>) => {
    setNotice('');
    setDraft({ ...content, ...patch });
  };

  const persistTemplate = async () => {
    await saveTemplate(docType, content);
    setDraft(null);
  };

  const saveOnly = async () => {
    setError('');
    if (!content.subject.trim()) {
      setError('The subject is required.');
      return;
    }
    setStatus('saving');
    try {
      await persistTemplate();
      setNotice(`Saved as the ${label} message.`);
    } catch {
      setError('Could not save the message. Try again.');
    } finally {
      setStatus('idle');
    }
  };

  const restoreDefault = () => {
    if (!window.confirm(`Replace the subject and message with the original ${label} template?`)) return;
    const d = defaultTemplate(docType);
    setDraft({ subject: d.subject, body: d.body });
    setEditorVersion((v) => v + 1);
  };

  const send = async () => {
    setError('');
    setNotice('');
    if (allRecipients.length === 0) {
      setError('Select at least one recipient.');
      return;
    }
    if (!content.subject.trim()) {
      setError('The subject is required.');
      return;
    }
    try {
      /* Lo editado queda como plantilla del documento (si esta marcado). */
      if (changed && remember) {
        setStatus('saving');
        await persistTemplate();
      }
      /* Tambien se recuerda a que correo del cliente se envia este documento. */
      if (customer && customerTargetChanged && remember) {
        await saveCustomerTo(docType, customerTarget);
      }
      setStatus('building');
      const attachment = await buildAttachment();
      setStatus('sending');
      const subject = fillTemplate(content.subject.trim(), values);
      const sendResults = await sendEmail({
        to: allRecipients,
        customerId: customerRecipients.length ? customerId : undefined,
        subject,
        html: wrapEmailHtml(fillTemplate(sanitizeEmailHtml(content.body), values, true)),
        attachments: [attachment],
      });
      /* Historial (Email Settings > Sent): quien lo envio y el resultado de cada destinatario. */
      createDocumentLocalFirst(COLLECTIONS.EMAIL_LOG, {
        DATE: new Date().toISOString(),
        DOC_TYPE: docType,
        DOC_LABEL: `${label} ${docRef}`.trim(),
        SUBJECT: subject,
        SENT_BY: auth.currentUser?.email ?? '',
        RECIPIENTS: sendResults.map((r) => ({ EMAIL: r.email, RESEND_ID: r.id ?? '', ERROR: r.error ?? '' })),
      });
      onSent?.();
      setResults(sendResults);
    } catch (e) {
      setError((e as Error).message || 'The email could not be sent.');
    } finally {
      setStatus('idle');
    }
  };

  const sendLabel =
    status === 'saving'
      ? 'Saving…'
      : status === 'building'
        ? 'Preparing PDF…'
        : status === 'sending'
          ? 'Sending…'
          : `Send to ${allRecipients.length || ''}`.trim();

  return (
    <Modal
      title={title}
      open
      wide
      onClose={busy ? () => undefined : onClose}
      confirmOnClose={false}
      footer={
        <>
          {results ? (
            <button type="button" className="btn btn--primary" onClick={onClose}>
              Close
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--secondary" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || allRecipients.length === 0 || loadingTemplates}
                onClick={() => void send()}
              >
                {sendLabel}
              </button>
            </>
          )}
        </>
      }
    >
      {results && (
        <div className="send-email__results">
          <p className="send-email__results-title">
            {results.every((r) => r.id)
              ? `${label} sent to ${results.length} ${results.length === 1 ? 'recipient' : 'recipients'}.`
              : `${label} sent to ${results.filter((r) => r.id).length} of ${results.length}. Check the ones in red.`}
          </p>
          <ul className="send-email__results-list">
            {results.map((r) => (
              <li key={r.email} className={`send-email__result${r.id ? ' send-email__result--ok' : ' send-email__result--bad'}`}>
                <b>{r.id ? '✓' : '✕'}</b> {r.email}
                {isCustomerEmail(r.email) && <span className="send-email__tag">customer</span>}
                {r.error && <span className="send-email__result-error"> — {r.error}</span>}
              </li>
            ))}
          </ul>
          <p className="send-email__muted">
            Delivery to each inbox can be checked in <b>Email Settings → Sent</b>.
          </p>
        </div>
      )}

      <div className={results ? 'send-email__hidden' : undefined}>
        <div className="send-email__recipients">
          <div className="send-email__to-head">
            <span className="send-email__label">To</span>
            {active.length > 1 && (
              <button
                type="button"
                className="send-email__link"
                disabled={busy}
                onClick={() => setPicked(allSelected ? [] : allEmails)}
              >
                {allSelected ? 'Clear all' : `Select all (${active.length})`}
              </button>
            )}
          </div>
          {loadingRecipients ? (
            <p className="send-email__muted">Loading recipients…</p>
          ) : active.length === 0 ? (
            <p className="send-email__muted">
              No authorized recipients yet. Add them in <b>Email Settings</b>.
            </p>
          ) : (
            <div className="send-email__list">
              {active.map((r) => (
                <label key={r.id} className={`send-email__option${selected.includes(r.EMAIL) ? ' send-email__option--on' : ''}`}>
                  <input type="checkbox" checked={selected.includes(r.EMAIL)} onChange={() => toggle(r.EMAIL)} disabled={busy} />
                  <span className="send-email__who">
                    <b>{r.NAME || r.EMAIL}</b>
                    {r.NAME && <span>{r.EMAIL}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
          {picked === null && active.some((r) => !defaultsFor(docType).includes(r.EMAIL)) && (
            <p className="send-email__muted">
              Unchecked addresses are not set to receive the {label} (Email Settings → Recipients). Check them here to include
              them.
            </p>
          )}
        </div>

        {customerId && (
          <div className="send-email__recipients">
            <span className="send-email__label">Customer{customer?.NAME_CUSTOMER ? ` — ${customer.NAME_CUSTOMER}` : ''}</span>
            <div className="send-email__list">
              {[
                { key: 'sales' as const, title: 'Sales Email', emails: salesEmails },
                { key: 'accounting' as const, title: 'Accounting Email', emails: accountingEmails },
              ].map((opt) => {
                const on = customerChoice[opt.key] && opt.emails.length > 0;
                return (
                  <label
                    key={opt.key}
                    className={`send-email__option${on ? ' send-email__option--on' : ''}${opt.emails.length === 0 ? ' send-email__option--off' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy || opt.emails.length === 0}
                      onChange={() => setCustomerPick({ ...customerChoice, [opt.key]: !customerChoice[opt.key] })}
                    />
                    <span className="send-email__who">
                      <b>{opt.title}</b>
                      <span>{opt.emails.length ? opt.emails.join(', ') : 'Not set — add it in Catalogs → Customers'}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {loadingTemplates ? (
          <p className="send-email__muted">Loading the saved message…</p>
        ) : (
          <EmailTemplateFields
            docType={docType}
            subject={content.subject}
            body={content.body}
            onSubjectChange={(subject) => update({ subject })}
            onBodyChange={(body) => update({ body })}
            editorKey={`${docType}-${editorVersion}`}
            previewValues={values}
            disabled={busy}
          />
        )}

        <div className="send-email__template-bar">
          <label className="send-email__remember">
            <input type="checkbox" checked={remember} disabled={busy} onChange={(e) => setRemember(e.target.checked)} />
            Save subject and message for every <b>{label}</b>
          </label>
          <div className="send-email__template-actions">
            {changed && (
              <button type="button" className="send-email__link" disabled={busy} onClick={() => void saveOnly()}>
                Save now
              </button>
            )}
            <button type="button" className="send-email__link" disabled={busy} onClick={restoreDefault}>
              Restore original
            </button>
          </div>
        </div>
        {notice && <p className="send-email__notice">{notice}</p>}

        <div className="send-email__attachment">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M21.4 11.1l-8.5 8.5a5.5 5.5 0 01-7.8-7.8l8.5-8.5a3.7 3.7 0 015.2 5.2l-8.5 8.5a1.8 1.8 0 01-2.6-2.6l7.8-7.8" />
          </svg>
          <span>{attachmentName}</span>
        </div>
      </div>

      {error && <p className="send-email__error">{error}</p>}
    </Modal>
  );
}
