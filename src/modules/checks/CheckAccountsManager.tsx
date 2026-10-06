import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import { bankLabel } from '../../hooks/useCheckAccounts';
import { COLLECTIONS, type CheckAccount, type CompanyBank } from '../../types/models';
import './CheckAccountsManager.css';

const MAX_LOGO_BYTES = 400 * 1024;

interface Props {
  accounts: CheckAccount[];
  canEdit: boolean;
  onClose: () => void;
}

type AccountDraft = Omit<CheckAccount, 'id'>;

const emptyAccount = (): AccountDraft => ({
  NAME: '',
  ADDRESS: '',
  CITY_STATE_ZIP: '',
  PHONE: '',
  EMAIL: '',
  LOGO: '',
  BANKS: [],
});

const emptyBank = (): CompanyBank => ({ id: crypto.randomUUID(), bankName: '', address: '', routing: '', account: '' });

/**
 * Checking Set-Up (como en AppSheet): lista de cuentas emisoras a la izquierda y,
 * a la derecha, la informacion de la cuenta con su tabla de bancos.
 */
export function CheckAccountsManager({ accounts, canEdit, onClose }: Props) {
  const [selectedId, setSelectedId] = useState(accounts[0]?.id ?? '');
  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0];

  /* Edicion de la cuenta (nueva o existente). */
  const [accountDraft, setAccountDraft] = useState<AccountDraft | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  /* Edicion de un banco de la cuenta seleccionada. */
  const [bankDraft, setBankDraft] = useState<CompanyBank | null>(null);

  const openNewAccount = () => {
    setEditingAccountId(null);
    setAccountDraft(emptyAccount());
  };
  const openEditAccount = (a: CheckAccount) => {
    setEditingAccountId(a.id);
    setAccountDraft({
      NAME: a.NAME ?? '',
      ADDRESS: a.ADDRESS ?? '',
      CITY_STATE_ZIP: a.CITY_STATE_ZIP ?? '',
      PHONE: a.PHONE ?? '',
      EMAIL: a.EMAIL ?? '',
      LOGO: a.LOGO ?? '',
      BANKS: a.BANKS ?? [],
    });
  };

  const handleLogoFile = (file: File | null) => {
    if (!file || !accountDraft) return;
    if (file.size > MAX_LOGO_BYTES) {
      alert('Logo too large. Please use an image under 400 KB (PNG or JPG).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAccountDraft((d) => (d ? { ...d, LOGO: String(reader.result ?? '') } : d));
    reader.readAsDataURL(file);
  };

  const saveAccount = async () => {
    if (!accountDraft) return;
    if (!accountDraft.NAME.trim()) {
      alert('Company name is required.');
      return;
    }
    const payload = {
      ...accountDraft,
      NAME: accountDraft.NAME.trim(),
      ADDRESS: accountDraft.ADDRESS.trim(),
      CITY_STATE_ZIP: accountDraft.CITY_STATE_ZIP.trim(),
      PHONE: accountDraft.PHONE.trim(),
      EMAIL: accountDraft.EMAIL.trim(),
    };
    try {
      if (editingAccountId) {
        await updateDocument<CheckAccount>(COLLECTIONS.CHECK_ACCOUNTS, editingAccountId, payload);
      } else {
        const id = await createDocument<CheckAccount>(COLLECTIONS.CHECK_ACCOUNTS, payload);
        setSelectedId(id);
      }
      setAccountDraft(null);
    } catch {
      alert('Could not save the account. Try again.');
    }
  };

  const removeAccount = async (a: CheckAccount) => {
    if (!window.confirm(`Delete the account "${a.NAME}"? Checks already written keep their data.`)) return;
    try {
      await deleteDocument(COLLECTIONS.CHECK_ACCOUNTS, a.id);
      setSelectedId('');
    } catch {
      alert('Could not delete the account. Try again.');
    }
  };

  const saveBank = async () => {
    if (!bankDraft || !selected) return;
    if (!bankDraft.bankName.trim() || !bankDraft.account.trim()) {
      alert('Bank name and account number are required.');
      return;
    }
    const clean = {
      ...bankDraft,
      bankName: bankDraft.bankName.trim(),
      address: bankDraft.address.trim(),
      routing: bankDraft.routing.trim(),
      account: bankDraft.account.trim(),
    };
    const banks = selected.BANKS ?? [];
    const next = banks.some((b) => b.id === clean.id) ? banks.map((b) => (b.id === clean.id ? clean : b)) : [...banks, clean];
    try {
      await updateDocument<CheckAccount>(COLLECTIONS.CHECK_ACCOUNTS, selected.id, { BANKS: next });
      setBankDraft(null);
    } catch {
      alert('Could not save the bank. Try again.');
    }
  };

  const removeBank = async (bank: CompanyBank) => {
    if (!selected) return;
    if (!window.confirm(`Delete ${bankLabel(bank)}? Checks already written keep their data.`)) return;
    try {
      await updateDocument<CheckAccount>(COLLECTIONS.CHECK_ACCOUNTS, selected.id, {
        BANKS: (selected.BANKS ?? []).filter((b) => b.id !== bank.id),
      });
    } catch {
      alert('Could not delete the bank. Try again.');
    }
  };

  const setField = (key: keyof AccountDraft, value: string) => setAccountDraft((d) => (d ? { ...d, [key]: value } : d));
  const setBankField = (key: keyof CompanyBank, value: string) => setBankDraft((d) => (d ? { ...d, [key]: value } : d));

  return (
    <>
      <Modal title="Checking Set-Up" open onClose={onClose} wide confirmOnClose={false}>
        <div className="check-setup">
          {/* Lista de cuentas */}
          <div className="check-setup__list">
            <div className="check-setup__list-head">
              <span className="check-setup__list-title">Accounts</span>
              {canEdit && (
                <button type="button" className="btn btn--primary" onClick={openNewAccount}>
                  + Add
                </button>
              )}
            </div>
            {accounts.length === 0 && <p className="check-setup__empty">No accounts yet.</p>}
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`check-setup__item${selected?.id === a.id ? ' check-setup__item--active' : ''}`}
                onClick={() => setSelectedId(a.id)}
              >
                {a.LOGO ? <img className="check-setup__logo" src={a.LOGO} alt="" /> : <span className="check-setup__logo-ph" />}
                <span className="check-setup__item-text">
                  <b>{a.NAME}</b>
                  <span>{a.ADDRESS}</span>
                </span>
              </button>
            ))}
          </div>

          {/* Detalle */}
          <div className="check-setup__detail">
            {!selected ? (
              <p className="check-setup__empty">Add an account to start writing checks.</p>
            ) : (
              <>
                <section className="check-setup__section">
                  <div className="check-setup__section-head">
                    <h3 className="check-setup__section-title">Account Information</h3>
                    {canEdit && (
                      <div className="check-setup__actions">
                        <button type="button" className="btn btn--secondary" onClick={() => openEditAccount(selected)}>
                          Edit
                        </button>
                        <button type="button" className="btn btn--danger" onClick={() => void removeAccount(selected)}>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  <dl className="check-setup__info">
                    <dt>Company Name</dt>
                    <dd>{selected.NAME || '—'}</dd>
                    <dt>Address</dt>
                    <dd>{selected.ADDRESS || '—'}</dd>
                    <dt>City State Zip</dt>
                    <dd>{selected.CITY_STATE_ZIP || '—'}</dd>
                    <dt>Phone</dt>
                    <dd>{selected.PHONE || '—'}</dd>
                    <dt>Email</dt>
                    <dd>{selected.EMAIL || '—'}</dd>
                  </dl>
                </section>

                <section className="check-setup__section">
                  <div className="check-setup__section-head">
                    <h3 className="check-setup__section-title">
                      Bank Information <span className="check-setup__count">{(selected.BANKS ?? []).length}</span>
                    </h3>
                    {canEdit && (
                      <button type="button" className="btn btn--secondary" onClick={() => setBankDraft(emptyBank())}>
                        + Add bank
                      </button>
                    )}
                  </div>
                  <div className="check-setup__table-wrap">
                    <table className="check-setup__table">
                      <thead>
                        <tr>
                          <th className="check-setup__th">Bank Name</th>
                          <th className="check-setup__th">Address</th>
                          <th className="check-setup__th">Routing</th>
                          <th className="check-setup__th">Account</th>
                          {canEdit && <th className="check-setup__th check-setup__th--actions">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {(selected.BANKS ?? []).length === 0 && (
                          <tr>
                            <td className="check-setup__td check-setup__td--empty" colSpan={canEdit ? 5 : 4}>
                              No banks yet.
                            </td>
                          </tr>
                        )}
                        {[...(selected.BANKS ?? [])]
                          .sort((a, b) => a.bankName.localeCompare(b.bankName))
                          .map((b) => (
                            <tr key={b.id}>
                              <td className="check-setup__td check-setup__td--strong">{b.bankName}</td>
                              <td className="check-setup__td">{b.address || '—'}</td>
                              <td className="check-setup__td check-setup__td--mono">{b.routing || '—'}</td>
                              <td className="check-setup__td check-setup__td--mono">{b.account || '—'}</td>
                              {canEdit && (
                                <td className="check-setup__td check-setup__td--actions">
                                  <button type="button" className="checks__action checks__action--edit" onClick={() => setBankDraft({ ...b })}>
                                    Edit
                                  </button>
                                  <button type="button" className="checks__action checks__action--delete" onClick={() => void removeBank(b)}>
                                    Delete
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </Modal>

      {accountDraft && (
        <Modal
          title={editingAccountId ? 'Edit account' : 'New account'}
          open
          onClose={() => setAccountDraft(null)}
          footer={
            <>
              <button type="button" className="btn btn--secondary" onClick={() => setAccountDraft(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void saveAccount()}>
                Save
              </button>
            </>
          }
        >
          <div className="check-setup__logo-row">
            {accountDraft.LOGO ? (
              <img className="check-setup__logo-lg" src={accountDraft.LOGO} alt="Logo" />
            ) : (
              <span className="check-setup__logo-ph check-setup__logo-ph--lg">No logo</span>
            )}
            <label className="btn btn--secondary check-setup__upload">
              Upload logo
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="check-setup__file"
                onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {accountDraft.LOGO && (
              <button type="button" className="btn btn--secondary" onClick={() => setField('LOGO', '')}>
                Remove
              </button>
            )}
          </div>
          <FormGrid>
            <FormField label="Company Name" required span2>
              <input className="input" value={accountDraft.NAME} onChange={(e) => setField('NAME', e.target.value)} />
            </FormField>
            <FormField label="Address" span2>
              <input className="input" value={accountDraft.ADDRESS} onChange={(e) => setField('ADDRESS', e.target.value)} />
            </FormField>
            <FormField label="City State Zip">
              <input className="input" value={accountDraft.CITY_STATE_ZIP} onChange={(e) => setField('CITY_STATE_ZIP', e.target.value)} />
            </FormField>
            <FormField label="Phone">
              <input className="input" value={accountDraft.PHONE} onChange={(e) => setField('PHONE', e.target.value)} />
            </FormField>
            <FormField label="Email" span2>
              <input className="input" type="email" value={accountDraft.EMAIL} onChange={(e) => setField('EMAIL', e.target.value)} />
            </FormField>
          </FormGrid>
        </Modal>
      )}

      {bankDraft && (
        <Modal
          title={(selected?.BANKS ?? []).some((b) => b.id === bankDraft.id) ? 'Edit bank' : 'New bank'}
          open
          onClose={() => setBankDraft(null)}
          footer={
            <>
              <button type="button" className="btn btn--secondary" onClick={() => setBankDraft(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void saveBank()}>
                Save
              </button>
            </>
          }
        >
          <FormGrid>
            <FormField label="Bank Name" required span2>
              <input className="input" value={bankDraft.bankName} onChange={(e) => setBankField('bankName', e.target.value)} />
            </FormField>
            <FormField label="Address" span2>
              <input className="input" value={bankDraft.address} onChange={(e) => setBankField('address', e.target.value)} />
            </FormField>
            <FormField label="Routing">
              <input className="input mono" value={bankDraft.routing} onChange={(e) => setBankField('routing', e.target.value)} />
            </FormField>
            <FormField label="Account" required>
              <input className="input mono" value={bankDraft.account} onChange={(e) => setBankField('account', e.target.value)} />
            </FormField>
          </FormGrid>
        </Modal>
      )}
    </>
  );
}
