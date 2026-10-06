import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { limit } from 'firebase/firestore';
import { READ_LIMIT } from '../../config/limits';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { accountAsCompany, bankLabel as labelOfBank, useCheckAccounts } from '../../hooks/useCheckAccounts';
import { CheckAccountsManager } from './CheckAccountsManager';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import { printCheck } from '../../services/checkPrintService';
import { COLLECTIONS, type Check } from '../../types/models';
import { Toolbar } from '../../components/ui/Toolbar';
import { DataPortButtons } from '../../components/ui/DataPortButtons';
import { CHECKS_SCHEMAS } from '../../config/entitySchemas';
import { confirmClose, Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { CatalogSelect } from '../../components/ui/CatalogSelect';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { fmtMoney, round2, todayISO, toNumber } from '../../utils/format';
import './ChecksView.css';

const fmtDate = (iso: string): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}` : iso;
};

export function ChecksView() {
  const { can } = useAuth();
  const { checkSettings } = useAppConfig();
  const { data: checks } = useCollection<Check>(COLLECTIONS.CHECKS, [limit(READ_LIMIT)]);
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  /* Direccion del beneficiario para el cheque (calle y ciudad del catalogo de clientes). */
  const { data: customerDocs } = useCollection<{ id: string; ADDRESS_CUSTOMER?: string; CITY_CUSTOMER?: string }>(
    COLLECTIONS.CUSTOMER,
  );
  /* Checking Set-Up: cuentas emisoras (empresa) con sus bancos. */
  const { accounts, accountOf, bankOf } = useCheckAccounts();
  const [setupOpen, setSetupOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Check | null>(null);

  const [checkNumber, setCheckNumber] = useState('');
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');
  const [bankId, setBankId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [memo, setMemo] = useState('');
  const [ref, setRef] = useState('');
  const [amount, setAmount] = useState('');

  const accountOptions = useMemo(() => accounts.map((a) => ({ id: a.id, name: a.NAME })), [accounts]);
  const selectedAccount = accounts.find((a) => a.id === accountId);
  /* Bank Account trae solo los bancos de la cuenta elegida. */
  const bankOptions = useMemo(
    () => (selectedAccount?.BANKS ?? []).map((b) => ({ id: b.id, name: labelOfBank(b) })),
    [selectedAccount],
  );

  /** Al cambiar de cuenta se propone su primer banco. */
  const changeAccount = (id: string) => {
    setAccountId(id);
    setBankId(accounts.find((a) => a.id === id)?.BANKS?.[0]?.id ?? '');
  };

  /** Etiquetas de la tabla (tolerantes con cheques importados de AppSheet). */
  const accountName = (c: Check): string => accountOf(c)?.NAME || c.ACCOUNT || '—';
  const bankName = (c: Check): string => {
    const bank = bankOf(accountOf(c), c.ID_BANK);
    return bank ? labelOfBank(bank) : c.ID_BANK || '—';
  };

  /** Siguiente consecutivo: max(cheques existentes, numero inicial configurado - 1) + 1. */
  const nextNumber = useMemo(() => {
    const maxExisting = checks.reduce((acc, c) => Math.max(acc, c.CHECK_NUMBER ?? 0), 0);
    const start = checkSettings.startNumber ?? 1;
    return Math.max(maxExisting, start - 1) + 1;
  }, [checks, checkSettings.startNumber]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    /* Mas reciente primero: por fecha del cheque, luego por numero. */
    const sorted = [...checks].sort(
      (a, b) => (b.DATE ?? '').localeCompare(a.DATE ?? '') || (b.CHECK_NUMBER ?? 0) - (a.CHECK_NUMBER ?? 0),
    );
    if (!term) return sorted;
    return sorted.filter((c) =>
      [String(c.CHECK_NUMBER ?? ''), customers.nameOf(c.ID_CUSTOMER), c.MEMO ?? '', c.REF ?? '', bankName(c), accountName(c)]
        .some((v) => v.toLowerCase().includes(term)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checks, search, customers, accountOf, bankOf]);

  const total = round2(rows.reduce((acc, c) => acc + (c.AMOUNT ?? 0), 0));

  const openCreate = () => {
    setEditing(null);
    /* Siguiente consecutivo al abrir (se vuelve a confirmar al guardar). */
    setCheckNumber(String(nextNumber));
    setDate(todayISO());
    /* Con una sola cuenta se elige sola, igual su primer banco. */
    const first = accounts.length === 1 ? accounts[0] : undefined;
    setAccountId(first?.id ?? '');
    setBankId(first?.BANKS?.[0]?.id ?? '');
    setCustomerId('');
    setMemo('');
    setRef('');
    setAmount('');
    setFormOpen(true);
  };

  const openEdit = (check: Check) => {
    setEditing(check);
    setCheckNumber(String(check.CHECK_NUMBER ?? ''));
    setDate(check.DATE ?? todayISO());
    const account = accountOf(check);
    setAccountId(account?.id ?? '');
    setBankId(bankOf(account, check.ID_BANK)?.id ?? '');
    setCustomerId(check.ID_CUSTOMER ?? '');
    setMemo(check.MEMO ?? '');
    setRef(check.REF ?? '');
    setAmount(String(check.AMOUNT ?? ''));
    setFormOpen(true);
  };

  /** Guardado local-first con confirmacion del consecutivo (no repetir ni saltar). */
  const handleSave = () => {
    const amountValue = round2(toNumber(amount));
    if (!accountId || !bankId) {
      alert('Select the account and its bank account.');
      return;
    }
    if (!customerId || amountValue <= 0) {
      alert('Customer and a positive amount are required.');
      return;
    }
    const requested = parseInt(checkNumber, 10);
    const editingId = editing?.id ?? null;
    const editingNumber = editing?.CHECK_NUMBER ?? null;
    setFormOpen(false);

    /* Confirmar numero contra la lista viva: si ya existe (y no es el que edito), tomar el siguiente. */
    let finalNumber = Number.isFinite(requested) && requested > 0 ? requested : nextNumber;
    const taken = new Set(checks.filter((c) => c.id !== editingId).map((c) => c.CHECK_NUMBER));
    if (finalNumber !== editingNumber) {
      while (taken.has(finalNumber)) finalNumber += 1;
    }

    const payload: Omit<Check, 'id'> = {
      CHECK_NUMBER: finalNumber,
      DATE: date,
      ID_ACCOUNT: accountId,
      ACCOUNT: selectedAccount?.NAME ?? '',
      ID_BANK: bankId,
      ID_CUSTOMER: customerId,
      MEMO: memo.trim(),
      REF: ref.trim(),
      AMOUNT: amountValue,
    };
    const persist = editingId
      ? updateDocument<Check>(COLLECTIONS.CHECKS, editingId, payload)
      : createDocument<Check>(COLLECTIONS.CHECKS, payload);
    persist.catch((error: unknown) =>
      alert(`Failed to save check: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  const handleDelete = () => {
    if (!editing) return;
    if (!window.confirm(`Delete check #${editing.CHECK_NUMBER}?`)) return;
    const id = editing.id;
    setFormOpen(false);
    deleteDocument(COLLECTIONS.CHECKS, id).catch((error: unknown) =>
      alert(`Failed to delete check: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  /** Imprime con los datos de la cuenta emisora y el banco del cheque. */
  const handlePrint = (check: Check) => {
    const account = accountOf(check);
    if (!account) {
      alert('This check has no account. Edit it and select the account first.');
      return;
    }
    const bank = bankOf(account, check.ID_BANK) ?? null;
    const payee = customerDocs.find((c) => c.id === check.ID_CUSTOMER);
    const payeeAddress = [payee?.ADDRESS_CUSTOMER ?? '', payee?.CITY_CUSTOMER ?? ''].filter((l) => l.trim()).join('\n');
    printCheck(check, customers.nameOf(check.ID_CUSTOMER), accountAsCompany(account), bank, checkSettings, payeeAddress);
  };

  /** Borrado directo desde la tabla (en segundo plano). */
  const handleDeleteRow = (check: Check) => {
    if (!window.confirm(`Delete check #${check.CHECK_NUMBER}?`)) return;
    deleteDocument(COLLECTIONS.CHECKS, check.id).catch((error: unknown) =>
      alert(`Failed to delete check: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  return (
    <div className="checks">
      <Toolbar title="Checkbook" subtitle={`${rows.length} checks · ${fmtMoney(total)}`} searchValue={search} onSearchChange={setSearch}>
        <button type="button" className="btn btn--secondary" onClick={() => setSetupOpen(true)}>
          Checking Set-Up
        </button>
        {can('checks', 'documents') && <DataPortButtons schemas={CHECKS_SCHEMAS} fileName="checks" />}
        {can('checks', 'add') && (
          <button type="button" className="btn btn--primary" onClick={openCreate}>+ Add check</button>
        )}
      </Toolbar>

      {!accounts.some((a) => (a.BANKS ?? []).length > 0) && (
        <div className="checks__notice">
          No bank accounts configured yet. Add the account and its banks in <strong>Checking Set-Up</strong> to write checks.
        </div>
      )}

      <div className="checks__card">
        <table className="checks__table">
          <thead>
            <tr>
              <th className="checks__th"># Check</th>
              <th className="checks__th">Date</th>
              <th className="checks__th">Account</th>
              <th className="checks__th">Bank account</th>
              <th className="checks__th">Customer</th>
              <th className="checks__th">Memo</th>
              <th className="checks__th">Ref #</th>
              <th className="checks__th checks__th--num">Amount</th>
              <th className="checks__th checks__th--right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className="checks__empty" colSpan={9}>No checks yet.</td></tr>
            )}
            {rows.map((check) => (
              <tr
                key={check.id}
                className="checks__row"
                onClick={() => (can('checks', 'edit') || can('checks', 'view')) && openEdit(check)}
              >
                <td className="checks__td checks__td--mono">{check.CHECK_NUMBER}</td>
                <td className="checks__td checks__td--muted">{fmtDate(check.DATE)}</td>
                <td className="checks__td">{accountName(check)}</td>
                <td className="checks__td checks__td--muted">{bankName(check)}</td>
                <td className="checks__td checks__td--strong">{customers.nameOf(check.ID_CUSTOMER)}</td>
                <td className="checks__td checks__td--muted">{check.MEMO || '—'}</td>
                <td className="checks__td checks__td--muted">{check.REF || '—'}</td>
                <td className="checks__td checks__td--num">{fmtMoney(check.AMOUNT ?? 0)}</td>
                <td className="checks__td checks__td--right">
                  {can('checks', 'documents') && (
                    <button
                      type="button"
                      className="checks__print"
                      title="Print check"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrint(check);
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><path d="M6 14h12v7H6z" />
                      </svg>
                    </button>
                  )}
                  {can('checks', 'edit') && (
                    <button
                      type="button"
                      className="checks__action checks__action--edit"
                      onClick={(e) => { e.stopPropagation(); openEdit(check); }}
                    >Edit</button>
                  )}
                  {can('checks', 'delete') && (
                    <button
                      type="button"
                      className="checks__action checks__action--delete"
                      onClick={(e) => { e.stopPropagation(); handleDeleteRow(check); }}
                    >Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {setupOpen && (
        <CheckAccountsManager accounts={accounts} canEdit={can('checks', 'edit')} onClose={() => setSetupOpen(false)} />
      )}

      <Modal
        title={editing ? `Edit check #${editing.CHECK_NUMBER}` : 'New check'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            {editing && can('checks', 'delete') && (
              <button type="button" className="btn btn--danger" onClick={handleDelete}>Delete</button>
            )}
            <button type="button" className="btn btn--secondary" onClick={() => confirmClose(() => setFormOpen(false))}>Cancel</button>
            {(editing ? can('checks', 'edit') : can('checks', 'add')) && (
              <button type="button" className="btn btn--primary" onClick={handleSave}>Save</button>
            )}
          </>
        }
      >
        <FormGrid>
          <FormField label="# Check">
            <input className="input mono" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
          </FormField>
          <FormField label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="Account" required span2>
            <SearchableSelect value={accountId} onChange={changeAccount} options={accountOptions} placeholder="Select company…" />
          </FormField>
          <FormField label="Bank Account" required span2>
            {accountId ? (
              <SearchableSelect value={bankId} onChange={setBankId} options={bankOptions} placeholder="Select bank account…" />
            ) : (
              <input className="input" value="" placeholder="Select the account first" disabled />
            )}
          </FormField>
          <FormField label="Customer" required span2>
            <CatalogSelect
              value={customerId}
              onChange={setCustomerId}
              options={customers.options}
              collection={COLLECTIONS.CUSTOMER}
              nameField="NAME_CUSTOMER"
              catalogLabel="customer"
            />
          </FormField>
          <FormField label="Memo" span2>
            <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </FormField>
          <FormField label="Ref #" span2>
            <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} />
          </FormField>
          <FormField label="Amount" required span2>
            <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>
        </FormGrid>
      </Modal>
    </div>
  );
}
