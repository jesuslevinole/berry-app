import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { Toolbar } from '../../components/ui/Toolbar';
import { confirmClose, Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { createDocument, updateDocument } from '../../services/firestore';
import { pathForCompany } from '../../services/tenant';
import { COLLECTIONS, type Company, type SystemUser } from '../../types/models';
import './CompaniesView.css';

/** Colecciones de negocio que viven dentro de cada empresa (para migrar datos legados). */
const TENANT_COLLECTIONS: string[] = [
  COLLECTIONS.PURCHASE_ORDER,
  COLLECTIONS.PURCHASE_DETAILS,
  COLLECTIONS.SALES_ORDER,
  COLLECTIONS.SALES_ORDER_DETAIL,
  COLLECTIONS.EXPENSES,
  COLLECTIONS.PAYMENT_SALES,
  COLLECTIONS.PAYMENT_BILL,
  COLLECTIONS.CUSTOMER,
  COLLECTIONS.USERS,
  COLLECTIONS.CATEGORY_BILL,
  COLLECTIONS.GROWER,
  COLLECTIONS.CARRIER,
  COLLECTIONS.LOCATIONS,
  COLLECTIONS.COMMODITIES,
  COLLECTIONS.SUPPLIERS,
  COLLECTIONS.SHIPVIA,
  COLLECTIONS.TERMSHIPPING,
  COLLECTIONS.PAYMENT_METHOD,
  COLLECTIONS.PAYMENTTERM,
  COLLECTIONS.CHECKS,
  COLLECTIONS.ROLES,
  COLLECTIONS.APP_SETTINGS,
  COLLECTIONS.COMPANY,
];

const emptyDraft = (): Omit<Company, 'id'> => ({ name: '', code: '', status: 'Active', notes: '' });

export function CompaniesView() {
  const { isPlatformAdmin, companyId, switchCompany, profile } = useAuth();
  const { data: companies, loading } = useCollection<Company>(COLLECTIONS.COMPANIES);
  const { data: users } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [draft, setDraft] = useState<Omit<Company, 'id'>>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [migrating, setMigrating] = useState('');
  const [migrationLog, setMigrationLog] = useState<string[]>([]);

  useEffect(() => {
    if (!formOpen) return;
    setDraft(editing ? { name: editing.name, code: editing.code ?? '', status: editing.status, notes: editing.notes ?? '' } : emptyDraft());
  }, [formOpen, editing]);

  const usersPerCompany = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of users) {
      if (!u.companyId) continue;
      counts.set(u.companyId, (counts.get(u.companyId) ?? 0) + 1);
    }
    return counts;
  }, [users]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return companies
      .filter((c) => !term || [c.name, c.code ?? ''].join(' ').toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [companies, search]);

  const save = async () => {
    if (!draft.name.trim()) {
      alert('The company needs a name.');
      return;
    }
    setSaving(true);
    try {
      if (editing) await updateDocument<Company>(COLLECTIONS.COMPANIES, editing.id, draft);
      else await createDocument<Company>(COLLECTIONS.COMPANIES, draft);
      setFormOpen(false);
      setEditing(null);
    } catch {
      alert('The company could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Migracion unica: copia los datos que estan en la raiz de Firestore (modelo
   * de una sola empresa) al subarbol companies/{id}. No borra el original, asi
   * que se puede repetir y verificar antes de limpiar.
   */
  const migrateLegacyData = async (company: Company) => {
    if (
      !window.confirm(
        `Copy all existing root-level data into "${company.name}"?\n\nThe original records are NOT deleted, so you can verify first.`,
      )
    ) {
      return;
    }
    setMigrating(company.id);
    setMigrationLog([]);
    const log: string[] = [];
    try {
      for (const colName of TENANT_COLLECTIONS) {
        const snap = await getDocs(collection(db, colName));
        if (snap.empty) continue;
        let written = 0;
        const docs = snap.docs;
        for (let start = 0; start < docs.length; start += 400) {
          const batch = writeBatch(db);
          for (const d of docs.slice(start, start + 400)) {
            batch.set(doc(db, pathForCompany(company.id, colName), d.id), d.data(), { merge: true });
            written += 1;
          }
          await batch.commit();
        }
        log.push(`${colName}: ${written}`);
        setMigrationLog([...log]);
      }
      /* Los usuarios sin empresa quedan asignados a esta. */
      let claimed = 0;
      for (const u of users) {
        if (u.companyId) continue;
        await setDoc(doc(db, COLLECTIONS.SYSTEM_USERS, u.id), { companyId: company.id }, { merge: true });
        claimed += 1;
      }
      if (claimed > 0) log.push(`system_users assigned: ${claimed}`);
      log.push('Done. Review the data inside the company before deleting the root copies.');
      setMigrationLog([...log]);
    } catch {
      setMigrationLog([...log, 'The migration stopped with an error. Nothing was deleted; you can run it again.']);
    } finally {
      setMigrating('');
    }
  };

  if (!isPlatformAdmin) {
    return (
      <div className="companies">
        <Toolbar title="Companies" subtitle="Platform administration" />
        <p className="companies__denied">Only platform administrators can manage companies.</p>
      </div>
    );
  }

  return (
    <div className="companies">
      <Toolbar
        title="Companies"
        subtitle="Every company keeps its own data, users and roles"
        searchValue={search}
        onSearchChange={setSearch}
      >
        <button type="button" className="btn btn--primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
          + Add company
        </button>
      </Toolbar>

      <div className="companies__card">
        <table className="companies__table">
          <thead>
            <tr>
              <th className="companies__th companies__th--actions">Actions</th>
              <th className="companies__th">Company</th>
              <th className="companies__th">Code</th>
              <th className="companies__th">Status</th>
              <th className="companies__th companies__th--num">Users</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td className="companies__empty" colSpan={5}>Loading\u2026</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td className="companies__empty" colSpan={5}>No companies yet. Create the first one.</td></tr>
            )}
            {rows.map((company) => (
              <tr key={company.id} className={company.id === companyId ? 'companies__row--current' : undefined}>
                <td className="companies__td companies__td--actions">
                  <button type="button" className="btn btn--secondary" onClick={() => { setEditing(company); setFormOpen(true); }}>
                    Edit
                  </button>
                  {company.id !== companyId && (
                    <button type="button" className="btn btn--secondary" onClick={() => switchCompany(company.id)}>
                      Open
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={migrating === company.id}
                    onClick={() => void migrateLegacyData(company)}
                    title="Copy legacy root-level records into this company"
                  >
                    {migrating === company.id ? 'Migrating\u2026' : 'Import legacy data'}
                  </button>
                </td>
                <td className="companies__td companies__td--strong">
                  {company.name}
                  {company.id === companyId && <span className="companies__badge">Current</span>}
                </td>
                <td className="companies__td companies__td--muted">{company.code || '\u2014'}</td>
                <td className="companies__td">{company.status}</td>
                <td className="companies__td companies__td--num">{usersPerCompany.get(company.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {migrationLog.length > 0 && (
        <div className="companies__log">
          <h4 className="companies__log-title">Migration</h4>
          <ul className="companies__log-list">
            {migrationLog.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="companies__hint">
        Signed in as <b>{profile?.email ?? 'platform admin'}</b>. Switching company reloads the app so
        no data from the previous company stays in memory.
      </p>

      <Modal
        title={editing ? 'Edit company' : 'New company'}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => confirmClose(() => { setFormOpen(false); setEditing(null); })}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving\u2026' : 'Save'}
            </button>
          </>
        }
      >
        <FormGrid>
          <FormField label="Company name">
            <input className="input" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </FormField>
          <FormField label="Code">
            <input className="input" value={draft.code} placeholder="BERRY, GATOR\u2026" onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} />
          </FormField>
          <FormField label="Status">
            <select className="input" value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as Company['status'] }))}>
              <option value="Active">Active</option>
              <option value="Suspended">Suspended</option>
            </select>
          </FormField>
          <FormField label="Notes" span2>
            <input className="input" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
          </FormField>
        </FormGrid>
      </Modal>
    </div>
  );
}
