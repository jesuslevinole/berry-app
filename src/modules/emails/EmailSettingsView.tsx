import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useEmailRecipients } from '../../hooks/useEmailRecipients';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import { isValidEmail } from '../../services/emailService';
import { EMAIL_DOC_TYPES } from '../../config/emailDocs';
import { COLLECTIONS, type EmailKey, type EmailRecipient } from '../../types/models';
import { useEmailBundles } from '../../hooks/useEmailBundles';
import { EmailBundlesPanel } from './EmailBundlesPanel';
import { Toolbar } from '../../components/ui/Toolbar';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { ToggleSwitch } from '../../components/ui/ToggleSwitch';
import { EmailTemplatesPanel } from './EmailTemplatesPanel';
import { EmailLogPanel } from './EmailLogPanel';
import '../../components/ui/SendEmailModal.css';
import './EmailSettingsView.css';

type Draft = Omit<EmailRecipient, 'id'>;

const emptyDraft = (): Draft => ({ NAME: '', EMAIL: '', ACTIVE: true, DOCS: EMAIL_DOC_TYPES.map((d) => d.id) });

/**
 * Email Settings: lista de correos autorizados para recibir documentos.
 * Al enviar un documento solo se puede elegir entre estos correos (el servidor
 * tambien lo valida). Las casillas por documento indican cuales vienen marcados.
 */
export function EmailSettingsView() {
  const { can } = useAuth();
  const canEdit = can('emails', 'edit') || can('emails', 'add');
  const { recipients, loading } = useEmailRecipients();
  /* Documentos + envios combinados: una columna por cada uno. */
  const { targets } = useEmailBundles();
  /* Mensaje que se abre en Messages (al venir de un combinado). */
  const [messageKey, setMessageKey] = useState<EmailKey>('invoice');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<'recipients' | 'combined' | 'messages' | 'sent'>('recipients');

  const term = search.trim().toLowerCase();
  const rows = recipients.filter((r) => !term || `${r.NAME} ${r.EMAIL}`.toLowerCase().includes(term));

  const openNew = () => {
    setEditingId(null);
    setDraft(emptyDraft());
  };
  const openEdit = (r: EmailRecipient) => {
    setEditingId(r.id);
    setDraft({ NAME: r.NAME ?? '', EMAIL: r.EMAIL ?? '', ACTIVE: r.ACTIVE !== false, DOCS: r.DOCS ?? [] });
  };

  const save = async () => {
    if (!draft) return;
    const email = draft.EMAIL.trim().toLowerCase();
    if (!isValidEmail(email)) {
      alert('Enter a valid email address.');
      return;
    }
    if (recipients.some((r) => r.id !== editingId && (r.EMAIL ?? '').toLowerCase() === email)) {
      alert('That email is already in the list.');
      return;
    }
    const payload: Draft = { ...draft, NAME: draft.NAME.trim(), EMAIL: email };
    try {
      if (editingId) await updateDocument<EmailRecipient>(COLLECTIONS.EMAIL_RECIPIENTS, editingId, payload);
      else await createDocument<EmailRecipient>(COLLECTIONS.EMAIL_RECIPIENTS, payload);
      setDraft(null);
    } catch {
      alert('Could not save the recipient. Try again.');
    }
  };

  const remove = async (r: EmailRecipient) => {
    if (!window.confirm(`Remove ${r.EMAIL} from the authorized recipients?`)) return;
    try {
      await deleteDocument(COLLECTIONS.EMAIL_RECIPIENTS, r.id);
    } catch {
      alert('Could not remove the recipient. Try again.');
    }
  };

  /** Cambios directos desde la tabla (activo / documento por defecto). */
  const patch = async (r: EmailRecipient, data: Partial<Draft>, key: string) => {
    setBusy(key);
    try {
      await updateDocument<EmailRecipient>(COLLECTIONS.EMAIL_RECIPIENTS, r.id, data);
    } catch {
      alert('Could not save the change. Try again.');
    } finally {
      setBusy('');
    }
  };
  const toggleDoc = (r: EmailRecipient, doc: EmailKey) => {
    const docs = r.DOCS ?? [];
    void patch(r, { DOCS: docs.includes(doc) ? docs.filter((d) => d !== doc) : [...docs, doc] }, `${r.id}:${doc}`);
  };

  const toggleDraftDoc = (doc: EmailKey) =>
    setDraft((d) => (d ? { ...d, DOCS: d.DOCS.includes(doc) ? d.DOCS.filter((x) => x !== doc) : [...d.DOCS, doc] } : d));

  return (
    <div className="email-settings">
      <Toolbar
        title="Email Settings"
        subtitle={`${recipients.filter((r) => r.ACTIVE !== false).length} active recipients`}
        searchValue={tab === 'recipients' ? search : undefined}
        onSearchChange={tab === 'recipients' ? setSearch : undefined}
      >
        {canEdit && tab === 'recipients' && (
          <button type="button" className="btn btn--primary" onClick={openNew}>
            + Add recipient
          </button>
        )}
      </Toolbar>

      <div className="email-settings__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'recipients'}
          className={`email-settings__tab${tab === 'recipients' ? ' email-settings__tab--active' : ''}`}
          onClick={() => setTab('recipients')}
        >
          Recipients
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'combined'}
          className={`email-settings__tab${tab === 'combined' ? ' email-settings__tab--active' : ''}`}
          onClick={() => setTab('combined')}
        >
          Combined
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'messages'}
          className={`email-settings__tab${tab === 'messages' ? ' email-settings__tab--active' : ''}`}
          onClick={() => setTab('messages')}
        >
          Messages
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sent'}
          className={`email-settings__tab${tab === 'sent' ? ' email-settings__tab--active' : ''}`}
          onClick={() => setTab('sent')}
        >
          Sent
        </button>
      </div>

      {tab === 'messages' && <EmailTemplatesPanel key={messageKey} canEdit={canEdit} initialKey={messageKey} />}

      {tab === 'combined' && <EmailBundlesPanel canEdit={canEdit} onEditMessage={(key) => {
        setMessageKey(key);
        setTab('messages');
      }} />}

      {tab === 'sent' && <EmailLogPanel />}

      {tab === 'recipients' && (
        <>
          <p className="email-settings__hint">
            Documents can only be emailed to the addresses on this list. The checked documents come pre-selected when sending.
          </p>

          <div className="email-settings__card">
            <table className="email-settings__table">
              <thead>
                <tr>
                  <th className="email-settings__th">Name</th>
                  <th className="email-settings__th">Email</th>
                  {targets.map((d) => (
                    <th
                      key={d.key}
                      className={`email-settings__th email-settings__th--center${d.bundle ? ' email-settings__th--bundle' : ''}`}
                      title={d.bundle ? 'Combined email' : undefined}
                    >
                      {d.label}
                    </th>
                  ))}
                  <th className="email-settings__th email-settings__th--center">Active</th>
                  {canEdit && <th className="email-settings__th email-settings__th--right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {!loading && rows.length === 0 && (
                  <tr>
                    <td className="email-settings__empty" colSpan={targets.length + 4}>
                      No recipients yet. Add the emails that can receive documents.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className={r.ACTIVE === false ? 'email-settings__row--off' : undefined}>
                    <td className="email-settings__td email-settings__td--strong">{r.NAME || '—'}</td>
                    <td className="email-settings__td">{r.EMAIL}</td>
                    {targets.map((d) => (
                      <td key={d.key} className="email-settings__td email-settings__td--center">
                        <input
                          type="checkbox"
                          className="email-settings__check"
                          aria-label={`${d.label} for ${r.EMAIL}`}
                          checked={(r.DOCS ?? []).includes(d.key)}
                          disabled={!canEdit || busy === `${r.id}:${d.key}`}
                          onChange={() => toggleDoc(r, d.key)}
                        />
                      </td>
                    ))}
                    <td className="email-settings__td email-settings__td--center">
                      <ToggleSwitch
                        on={r.ACTIVE !== false}
                        label={`Active: ${r.EMAIL}`}
                        disabled={!canEdit || busy === `${r.id}:active`}
                        onToggle={() => void patch(r, { ACTIVE: r.ACTIVE === false }, `${r.id}:active`)}
                      />
                    </td>
                    {canEdit && (
                      <td className="email-settings__td email-settings__td--right">
                        <button type="button" className="checks__action checks__action--edit" onClick={() => openEdit(r)}>
                          Edit
                        </button>
                        <button type="button" className="checks__action checks__action--delete" onClick={() => void remove(r)}>
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {draft && (
        <Modal
          title={editingId ? 'Edit recipient' : 'New recipient'}
          open
          onClose={() => setDraft(null)}
          footer={
            <>
              <button type="button" className="btn btn--secondary" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void save()}>
                Save
              </button>
            </>
          }
        >
          <FormGrid>
            <FormField label="Name">
              <input
                className="input"
                value={draft.NAME}
                onChange={(e) => setDraft({ ...draft, NAME: e.target.value })}
                placeholder="Accounting — Gator Produce"
              />
            </FormField>
            <FormField label="Email" required>
              <input
                className="input"
                type="email"
                value={draft.EMAIL}
                onChange={(e) => setDraft({ ...draft, EMAIL: e.target.value })}
              />
            </FormField>
            <FormField label="Pre-selected for" span2>
              <div className="email-settings__docs">
                {targets.map((d) => (
                  <label key={d.key} className="email-settings__doc">
                    <input type="checkbox" checked={draft.DOCS.includes(d.key)} onChange={() => toggleDraftDoc(d.key)} />
                    {d.label}
                  </label>
                ))}
              </div>
            </FormField>
            <FormField label="Active">
              <ToggleSwitch on={draft.ACTIVE} label="Active" onToggle={() => setDraft({ ...draft, ACTIVE: !draft.ACTIVE })} />
            </FormField>
          </FormGrid>
        </Modal>
      )}
    </div>
  );
}
