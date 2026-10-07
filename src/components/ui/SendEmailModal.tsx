import { useState } from 'react';
import { Modal } from './Modal';
import { EmailTemplateFields } from './EmailTemplateFields';
import { useEmailRecipients } from '../../hooks/useEmailRecipients';
import { useEmailTemplates, type TemplateContent } from '../../hooks/useEmailTemplates';
import { parseEmails, sendEmail, type EmailAttachment, type RecipientResult } from '../../services/emailService';
import { useCollection } from '../../hooks/useCollection';
import { createDocumentLocalFirst, updateDocument } from '../../services/firestore';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../firebase/config';
import { defaultTemplate, fillTemplate, sanitizeEmailHtml, wrapEmailHtml } from '../../services/emailTemplates';
import { targetFrom } from '../../config/emailDocs';
import { COLLECTIONS, type EmailKey, type EmailRecipient } from '../../types/models';
import './SendEmailModal.css';

export interface PendingAttachment {
  /** Nombre del archivo (se muestra antes de enviar). */
  name: string;
  /** Genera el adjunto al momento de enviar (PDF en base64). */
  build: () => Promise<EmailAttachment>;
}

interface Props {
  /** Documento o envio combinado: decide destinatarios marcados y la plantilla guardada. */
  emailKey: EmailKey;
  /** Nombre de lo que se envia ("Invoice", "Pick Tix and BOL"...). */
  label: string;
  title: string;
  /** Referencia del documento para el historial (ej. "46117" o el nombre del cliente). */
  docRef: string;
  /** Cliente del documento: permite enviarlo tambien a su Sales Email / Accounting Email. */
  customerId?: string;
  /** Como se llama al cliente en este documento ("Customer", "Vendor"). */
  customerLabel?: string;
  /** Warehouse (Catalogs > Locations) de la orden: se le puede enviar en lugar del cliente. */
  warehouseId?: string;
  /** Valores de las variables de la plantilla ({{customer}}, {{number}}...). */
  values: Record<string, string>;
  /** Archivos que se adjuntan (uno o varios en un mismo correo). */
  attachments: PendingAttachment[];
  onClose: () => void;
  onSent?: () => void;
}

/**
 * Envia un documento por correo. Destinatarios: solo los autorizados en Email Settings.
 * Asunto y mensaje: la plantilla guardada del documento; lo que se edite aqui se guarda
 * como la nueva plantilla de ese documento (para la proxima vez solo presionar Send).
 */
export function SendEmailModal({
  emailKey,
  label,
  title,
  docRef,
  customerId,
  customerLabel = 'Customer',
  warehouseId,
  values,
  attachments,
  onClose,
  onSent,
}: Props) {
  const docType = emailKey;
  const { active, defaultsFor, loading: loadingRecipients } = useEmailRecipients();
  const { templateFor, saveTemplate, saveCustomerTo, saveWarehouseTo, loading: loadingTemplates } = useEmailTemplates();
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
  /* Warehouse = Catalogs > Locations (la consulta tambien la comparte Sales Desk). */
  const { data: locationDocs } = useCollection<{ id: string; NAME_LOCATIONS?: string; EMAIL_LOCATIONS?: string }>(
    COLLECTIONS.LOCATIONS,
  );
  const warehouse = warehouseId ? locationDocs.find((l) => l.id === warehouseId) : undefined;
  const warehouseEmails = parseEmails(warehouse?.EMAIL_LOCATIONS ?? '');

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
  /* Envio al Warehouse: por defecto lo guardado para este documento. */
  const [warehousePick, setWarehousePick] = useState<boolean | null>(null);
  const warehouseOn = warehousePick ?? saved.warehouseTo;
  const warehouseChanged = warehousePick !== null && warehousePick !== saved.warehouseTo;
  const warehouseRecipients = warehouse && warehouseOn ? warehouseEmails : [];
  /* Correos del cliente que se van a incluir. */
  const customerRecipients = customer
    ? [...(customerChoice.sales ? salesEmails : []), ...(customerChoice.accounting ? accountingEmails : [])]
    : [];
  /* Todos los destinatarios (sin repetir). */
  const allRecipients = [
    ...new Map([...selected, ...customerRecipients, ...warehouseRecipients].map((e) => [e.toLowerCase(), e])).values(),
  ];
  const isCustomerEmail = (email: string): boolean => customerRecipients.some((c) => c.toLowerCase() === email.toLowerCase());
  const isWarehouseEmail = (email: string): boolean => warehouseRecipients.some((c) => c.toLowerCase() === email.toLowerCase());
  const content = draft ?? { subject: saved.subject, body: saved.body };
  const changed = !!draft && (draft.subject !== saved.subject || draft.body !== saved.body);
  const [editorVersion, setEditorVersion] = useState(0);

  const [remember, setRemember] = useState(true);
  /* Pestanas del modal: el mensaje primero; los destinatarios se configuran en la segunda. */
  const [tab, setTab] = useState<'message' | 'recipients'>('message');
  const [status, setStatus] = useState<'idle' | 'saving' | 'building' | 'sending'>('idle');
  /* Adjunto que se esta generando (1 de N). */
  const [buildingIndex, setBuildingIndex] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  /* Resultado por destinatario despues de enviar. */
  const [results, setResults] = useState<RecipientResult[] | null>(null);
  const busy = status !== 'idle';
  const allEmails = active.map((r) => r.EMAIL);
  const allSelected = allEmails.length > 0 && allEmails.every((e) => selected.includes(e));

  /* ---- Settings: guardar los destinatarios como predeterminados de este documento ---- */
  const { can } = useAuth();
  const canSaveSettings = can('emails', 'edit') || can('emails', 'add');
  const savedDefaults = defaultsFor(docType);
  const recipientsChanged =
    picked !== null &&
    (picked.length !== savedDefaults.length || picked.some((e) => !savedDefaults.includes(e)));
  const settingsDirty = recipientsChanged || (!!customer && customerTargetChanged) || (!!warehouse && warehouseChanged);
  const [settingsStatus, setSettingsStatus] = useState<'' | 'saving' | 'saved' | 'error'>('');

  const saveSettings = async () => {
    setSettingsStatus('saving');
    try {
      /* Cada destinatario de Email Settings queda marcado (o no) para este documento. */
      for (const r of active) {
        const docs = r.DOCS ?? [];
        const want = selected.includes(r.EMAIL);
        if (docs.includes(docType) !== want) {
          await updateDocument<EmailRecipient>(COLLECTIONS.EMAIL_RECIPIENTS, r.id, {
            DOCS: want ? [...docs, docType] : docs.filter((d) => d !== docType),
          });
        }
      }
      if (customer && customerTargetChanged) await saveCustomerTo(docType, customerTarget);
      if (warehouse && warehouseChanged) await saveWarehouseTo(docType, warehouseOn);
      /* Lo guardado pasa a ser lo predeterminado. */
      setPicked(null);
      setCustomerPick(null);
      setWarehousePick(null);
      setSettingsStatus('saved');
    } catch {
      setSettingsStatus('error');
    }
  };

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
      if (warehouse && warehouseChanged && remember) await saveWarehouseTo(docType, warehouseOn);
      setStatus('building');
      /* Uno por uno: cada PDF se pinta en un iframe oculto. */
      const files: EmailAttachment[] = [];
      for (let i = 0; i < attachments.length; i += 1) {
        setBuildingIndex(i);
        files.push(await attachments[i].build());
      }
      setStatus('sending');
      const subject = fillTemplate(content.subject.trim(), values);
      const sendResults = await sendEmail({
        to: allRecipients,
        customerId: customerRecipients.length ? customerId : undefined,
        warehouseId: warehouseRecipients.length ? warehouseId : undefined,
        subject,
        html: wrapEmailHtml(fillTemplate(sanitizeEmailHtml(content.body), values, true)),
        attachments: files,
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
        ? attachments.length > 1
          ? `Preparing PDF ${buildingIndex + 1} of ${attachments.length}…`
          : 'Preparing PDF…'
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
                {isWarehouseEmail(r.email) && <span className="send-email__tag">warehouse</span>}
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
        <div className="send-email__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'message'}
            className={`send-email__tab${tab === 'message' ? ' send-email__tab--active' : ''}`}
            onClick={() => setTab('message')}
          >
            Message
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'recipients'}
            className={`send-email__tab${tab === 'recipients' ? ' send-email__tab--active' : ''}`}
            onClick={() => setTab('recipients')}
          >
            Settings <span className="send-email__tab-count">{allRecipients.length}</span>
          </button>
        </div>

        {tab === 'message' && (
          <>
            <p className="send-email__summary">
              {allRecipients.length === 0 ? (
                <span className="send-email__summary-warn">No recipients selected.</span>
              ) : (
                <>
                  <b>To:</b> {allRecipients.join(', ')}
                </>
              )}{' '}
              <button type="button" className="send-email__link" disabled={busy} onClick={() => setTab('recipients')}>
                Change
              </button>
            </p>
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

            <div className="send-email__attachments">
              <span className="send-email__label">
                {attachments.length > 1 ? `${attachments.length} attachments` : 'Attachment'}
              </span>
              {attachments.map((a) => (
                <div key={a.name} className="send-email__attachment">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M21.4 11.1l-8.5 8.5a5.5 5.5 0 01-7.8-7.8l8.5-8.5a3.7 3.7 0 015.2 5.2l-8.5 8.5a1.8 1.8 0 01-2.6-2.6l7.8-7.8" />
                  </svg>
                  <span>{a.name}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'recipients' && (
          <>
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
                  Unchecked addresses are not set to receive the {label}. Check them and press <b>Save settings</b> to keep them checked.
                </p>
              )}
            </div>

            {customerId && (
              <div className="send-email__recipients">
                <span className="send-email__label">
                  {customerLabel}
                  {customer?.NAME_CUSTOMER ? ` — ${customer.NAME_CUSTOMER}` : ''}
                </span>
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
                          {opt.emails.length ? (
                            <span className="send-email__emails">
                              {opt.emails.map((e) => (
                                <span key={e} className="send-email__email-chip">
                                  {e}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span>Not set — add it in Catalogs → Customers</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {warehouseId && (
              <div className="send-email__recipients">
                <span className="send-email__label">
                  Warehouse{warehouse?.NAME_LOCATIONS ? ` — ${warehouse.NAME_LOCATIONS}` : ''}
                </span>
                <div className="send-email__list">
                  <label
                    className={`send-email__option${warehouseOn && warehouseEmails.length ? ' send-email__option--on' : ''}${warehouseEmails.length === 0 ? ' send-email__option--off' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={warehouseOn && warehouseEmails.length > 0}
                      disabled={busy || warehouseEmails.length === 0}
                      onChange={() => setWarehousePick(!warehouseOn)}
                    />
                    <span className="send-email__who">
                      <b>Warehouse Email</b>
                      {warehouseEmails.length ? (
                        <span className="send-email__emails">
                          {warehouseEmails.map((e) => (
                            <span key={e} className="send-email__email-chip">
                              {e}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span>Not set — add it in Catalogs → Locations</span>
                      )}
                    </span>
                  </label>
                </div>
              </div>
            )}

            {canSaveSettings && (
              <div className="send-email__settings-bar">
                <span className="send-email__settings-hint">
                  Save these recipients as the default for every <b>{label}</b>.
                </span>
                {settingsStatus === 'saved' && !settingsDirty && <span className="send-email__settings-state">Saved</span>}
                {settingsStatus === 'error' && (
                  <span className="send-email__settings-state send-email__settings-state--error">Could not save. Try again.</span>
                )}
                {settingsDirty && settingsStatus !== 'saving' && (
                  <span className="send-email__settings-state send-email__settings-state--pending">Unsaved changes</span>
                )}
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || !settingsDirty || settingsStatus === 'saving'}
                  onClick={() => void saveSettings()}
                >
                  {settingsStatus === 'saving' ? 'Saving…' : 'Save settings'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {error && <p className="send-email__error">{error}</p>}
    </Modal>
  );
}
