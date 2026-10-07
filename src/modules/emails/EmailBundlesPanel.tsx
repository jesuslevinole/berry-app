import { useState } from 'react';
import { useEmailBundles } from '../../hooks/useEmailBundles';
import { useEmailRecipients } from '../../hooks/useEmailRecipients';
import { useEmailTemplates } from '../../hooks/useEmailTemplates';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import { CUSTOMER_TARGETS, SALES_DOC_TYPES, bundleDocsLabel, bundleKey } from '../../config/emailDocs';
import {
  COLLECTIONS,
  type CustomerEmailTarget,
  type EmailBundle,
  type EmailKey,
  type EmailRecipient,
  type SalesDocType,
} from '../../types/models';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import './EmailBundlesPanel.css';

interface Props {
  canEdit: boolean;
  /** Ir a Messages para editar el asunto y mensaje del combinado. */
  onEditMessage: (key: EmailKey) => void;
}

interface Draft {
  id: string | null;
  NAME: string;
  DOCS: SalesDocType[];
  /** Correos de Email Settings marcados por defecto. */
  recipients: string[];
  customerTo: CustomerEmailTarget;
}

/**
 * Email Settings > Combined: envios con varios documentos en un mismo correo
 * (ej. "Pick Tix and BOL" para el almacen). Cada uno tiene nombre, documentos,
 * destinatarios, correo del cliente y su propio mensaje (pestana Messages).
 */
export function EmailBundlesPanel({ canEdit, onEditMessage }: Props) {
  const { bundles, loading } = useEmailBundles();
  const { active, defaultsFor } = useEmailRecipients();
  const { templateFor, saveCustomerTo } = useEmailTemplates();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const openNew = () =>
    setDraft({ id: null, NAME: '', DOCS: ['pick', 'bol'], recipients: [], customerTo: 'none' });

  const openEdit = (b: EmailBundle) => {
    const key = bundleKey(b.id);
    setDraft({
      id: b.id,
      NAME: b.NAME ?? '',
      DOCS: b.DOCS ?? [],
      recipients: defaultsFor(key),
      customerTo: templateFor(key).customerTo,
    });
  };

  const toggleDoc = (doc: SalesDocType) =>
    setDraft((d) => (d ? { ...d, DOCS: d.DOCS.includes(doc) ? d.DOCS.filter((x) => x !== doc) : [...d.DOCS, doc] } : d));

  const toggleRecipient = (email: string) =>
    setDraft((d) =>
      d ? { ...d, recipients: d.recipients.includes(email) ? d.recipients.filter((x) => x !== email) : [...d.recipients, email] } : d,
    );

  const save = async () => {
    if (!draft) return;
    const name = draft.NAME.trim();
    if (!name) {
      alert('Give the combined email a name (e.g. Pick Tix and BOL).');
      return;
    }
    if (draft.DOCS.length < 2) {
      alert('Choose at least two documents.');
      return;
    }
    if (bundles.some((b) => b.id !== draft.id && (b.NAME ?? '').trim().toLowerCase() === name.toLowerCase())) {
      alert('There is already a combined email with that name.');
      return;
    }
    setSaving(true);
    try {
      /* Orden fijo de los documentos (Invoice, Pick Ticket, Sales Order, BOL). */
      const docs = SALES_DOC_TYPES.map((d) => d.id).filter((id) => draft.DOCS.includes(id));
      const payload = { NAME: name, DOCS: docs };
      const id = draft.id
        ? (await updateDocument<EmailBundle>(COLLECTIONS.EMAIL_BUNDLES, draft.id, payload), draft.id)
        : await createDocument<EmailBundle>(COLLECTIONS.EMAIL_BUNDLES, payload);
      const key = bundleKey(id);

      /* Destinatarios marcados por defecto: se agrega o quita la clave en cada uno. */
      const changes = active.filter((r) => (r.DOCS ?? []).includes(key) !== draft.recipients.includes(r.EMAIL));
      for (const r of changes) {
        const docsNow = r.DOCS ?? [];
        await updateDocument<EmailRecipient>(COLLECTIONS.EMAIL_RECIPIENTS, r.id, {
          DOCS: docsNow.includes(key) ? docsNow.filter((d) => d !== key) : [...docsNow, key],
        });
      }
      if (draft.customerTo !== templateFor(key).customerTo) await saveCustomerTo(key, draft.customerTo);
      setDraft(null);
    } catch {
      alert('Could not save the combined email. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (b: EmailBundle) => {
    if (!window.confirm(`Delete the combined email "${b.NAME}"? Its saved message is deleted too.`)) return;
    try {
      await deleteDocument(COLLECTIONS.EMAIL_BUNDLES, b.id);
      await deleteDocument(COLLECTIONS.EMAIL_TEMPLATES, bundleKey(b.id)).catch(() => undefined);
      setDraft(null);
    } catch {
      alert('Could not delete it. Try again.');
    }
  };

  const customerLabel = (t: CustomerEmailTarget): string =>
    t === 'none' ? 'No' : (CUSTOMER_TARGETS.find((c) => c.id === t)?.label ?? t).replace('Customer ', '').replace('customer ', '');

  return (
    <div className="email-bundles">
      <div className="email-bundles__bar">
        <p className="email-settings__hint">
          Send two or more documents of a sales order in <b>one email</b>. They appear under <b>Send together</b> when generating
          documents in Sales Desk.
        </p>
        {canEdit && (
          <button type="button" className="btn btn--primary" onClick={openNew}>
            + New combined email
          </button>
        )}
      </div>

      <div className="email-settings__card">
        <table className="email-settings__table">
          <thead>
            <tr>
              <th className="email-settings__th">Name</th>
              <th className="email-settings__th">Documents</th>
              <th className="email-settings__th">Sent to</th>
              <th className="email-settings__th">Customer</th>
              {canEdit && <th className="email-settings__th email-settings__th--right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {!loading && bundles.length === 0 && (
              <tr>
                <td className="email-settings__empty" colSpan={5}>
                  No combined emails yet. Example: “Pick Tix and BOL” with the Pick Ticket and the Bill of Lading for the
                  warehouse.
                </td>
              </tr>
            )}
            {bundles.map((b) => {
              const key = bundleKey(b.id);
              const to = active.filter((r) => (r.DOCS ?? []).includes(key));
              return (
                <tr key={b.id}>
                  <td className="email-settings__td email-settings__td--strong">{b.NAME}</td>
                  <td className="email-settings__td">{bundleDocsLabel(b.DOCS ?? [])}</td>
                  <td className="email-settings__td email-bundles__to">
                    {to.length ? to.map((r) => r.NAME || r.EMAIL).join(', ') : <span className="email-bundles__muted">Nobody pre-selected</span>}
                  </td>
                  <td className="email-settings__td">{customerLabel(templateFor(key).customerTo)}</td>
                  {canEdit && (
                    <td className="email-settings__td email-settings__td--right">
                      <button type="button" className="checks__action checks__action--edit" onClick={() => openEdit(b)}>
                        Edit
                      </button>
                      <button type="button" className="checks__action checks__action--delete" onClick={() => void remove(b)}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {draft && (
        <Modal
          title={draft.id ? 'Edit combined email' : 'New combined email'}
          open
          onClose={() => setDraft(null)}
          footer={
            <>
              <button type="button" className="btn btn--secondary" disabled={saving} onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <FormGrid>
            <FormField label="Name" required span2>
              <input
                className="input"
                value={draft.NAME}
                placeholder="Pick Tix and BOL"
                onChange={(e) => setDraft({ ...draft, NAME: e.target.value })}
              />
            </FormField>
            <FormField label="Documents in the email (2 or more)" span2>
              <div className="email-settings__docs">
                {SALES_DOC_TYPES.map((d) => (
                  <label key={d.id} className="email-settings__doc">
                    <input type="checkbox" checked={draft.DOCS.includes(d.id)} onChange={() => toggleDoc(d.id)} />
                    {d.label}
                  </label>
                ))}
              </div>
            </FormField>
            <FormField label="Pre-selected recipients (Email Settings)" span2>
              {active.length === 0 ? (
                <p className="email-bundles__muted">Add recipients in the Recipients tab first.</p>
              ) : (
                <div className="email-bundles__recipients">
                  {active.map((r) => (
                    <label key={r.id} className="email-settings__doc">
                      <input type="checkbox" checked={draft.recipients.includes(r.EMAIL)} onChange={() => toggleRecipient(r.EMAIL)} />
                      <span>
                        <b>{r.NAME || r.EMAIL}</b>
                        {r.NAME && <span className="email-bundles__muted"> {r.EMAIL}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </FormField>
            <FormField label="Also send to the customer" span2>
              <select
                className="input"
                value={draft.customerTo}
                onChange={(e) => setDraft({ ...draft, customerTo: e.target.value as CustomerEmailTarget })}
              >
                {CUSTOMER_TARGETS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </FormField>
          </FormGrid>
          {draft.id && (
            <button
              type="button"
              className="send-email__link email-bundles__message-link"
              onClick={() => {
                const id = draft.id;
                setDraft(null);
                if (id) onEditMessage(bundleKey(id));
              }}
            >
              Edit the subject and message →
            </button>
          )}
        </Modal>
      )}
    </div>
  );
}
