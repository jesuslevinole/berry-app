import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { Toolbar } from '../../components/ui/Toolbar';
import { confirmClose, Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { ToggleSwitch } from '../../components/ui/ToggleSwitch';
import { createDocument, updateDocument } from '../../services/firestore';
import { copyLegacyCollection, LEGACY_TENANT_COLLECTIONS } from '../../services/legacyMigrationService';
import { updateSystemUser } from '../../services/systemUsersService';
import { approveCompany } from '../../services/companyAdminService';
import { COLLECTIONS, type Company, type SystemUser } from '../../types/models';
import './CompaniesView.css';

const emptyDraft = (): Omit<Company, 'id'> => ({ name: '', code: '', status: 'Active', notes: '', exempt: false });

const STATUS_LABELS: Record<Company['status'], string> = {
  Active: 'Active',
  Pending: 'Pending approval',
  Suspended: 'Suspended',
};

/** Pendientes de aprobacion primero; despues por nombre. */
const byPendingThenName = (a: Company, b: Company): number =>
  Number(b.status === 'Pending') - Number(a.status === 'Pending') || a.name.localeCompare(b.name);

export function CompaniesView() {
  const { isPlatformAdmin, companyId, firebaseUser } = useAuth();
  const { data: companies, loading } = useCollection<Company>(COLLECTIONS.COMPANIES);
  const { data: users } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [draft, setDraft] = useState<Omit<Company, 'id'>>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [migrating, setMigrating] = useState('');
  const [approving, setApproving] = useState('');
  const [migrationLog, setMigrationLog] = useState<string[]>([]);

  useEffect(() => {
    if (!formOpen) return;
    setDraft(editing ? { name: editing.name, code: editing.code ?? '', status: editing.status, notes: editing.notes ?? '', exempt: editing.exempt ?? false } : emptyDraft());
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
      .sort(byPendingThenName);
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

  /* Empresa registrada sola: se activa con su prueba gratuita. */
  const handleApprove = async (company: Company) => {
    if (!window.confirm(`Approve "${company.name}"? Its owner can start working right away.`)) return;
    setApproving(company.id);
    try {
      await approveCompany(company, users);
    } catch {
      alert('The company could not be approved. Try again.');
    } finally {
      setApproving('');
    }
  };

  const handleExemptToggle = () => setDraft((d) => ({ ...d, exempt: !d.exempt }));

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
      for (const colName of LEGACY_TENANT_COLLECTIONS) {
        const written = await copyLegacyCollection(company.id, colName);
        if (written === 0) continue;
        log.push(`${colName}: ${written}`);
        setMigrationLog([...log]);
      }
      /* Los usuarios sin empresa quedan asignados a esta. */
      let claimed = 0;
      for (const u of users) {
        if (u.companyId) continue;
        await updateSystemUser(u.id, { companyId: company.id });
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

      {!loading && companies.length === 0 && (
        <div className="companies__onboarding">
          <h4 className="companies__onboarding-title">Set up your first company</h4>
          <ol className="companies__steps">
            <li>Create the company (for the current data, use <b>Berry Source, LC</b>).</li>
            <li>Press <b>Import legacy data</b> on that company: it copies every existing record
              into it and assigns the users. Nothing is deleted.</li>
            <li>Sign out and choose it when you sign in. From then on the app behaves exactly as before.</li>
          </ol>
        </div>
      )}

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
            {loading && <tr><td className="companies__empty" colSpan={5}>Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td className="companies__empty" colSpan={5}>No companies yet. Create the first one.</td></tr>
            )}
            {rows.map((company) => (
              <tr key={company.id} className={company.id === companyId ? 'companies__row--current' : undefined}>
                <td className="companies__td companies__td--actions">
                  {company.status === 'Pending' && (
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={approving === company.id}
                      onClick={() => void handleApprove(company)}
                    >
                      {approving === company.id ? 'Approving\u2026' : 'Approve'}
                    </button>
                  )}
                  <button type="button" className="btn btn--secondary" onClick={() => { setEditing(company); setFormOpen(true); }}>
                    Edit
                  </button>
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
                <td className="companies__td">
                  <span className={`companies__status companies__status--${company.status.toLowerCase()}`}>
                    {STATUS_LABELS[company.status] ?? company.status}
                  </span>
                  {company.exempt && <span className="companies__badge">No payment required</span>}
                </td>
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
        Signed in as <b>{firebaseUser?.email ?? 'platform admin'}</b>. To work inside a company, sign out
        and choose it when you sign in.
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
            <input className="input" value={draft.code} placeholder="BERRY, GATOR…" onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} />
          </FormField>
          <FormField label="Status">
            <select className="input" value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as Company['status'] }))}>
              <option value="Active">Active</option>
              <option value="Pending">Pending approval</option>
              <option value="Suspended">Suspended</option>
            </select>
          </FormField>
          <FormField label="No payment required (free access)">
            <ToggleSwitch on={!!draft.exempt} onToggle={handleExemptToggle} label="No payment required" />
          </FormField>
          <FormField label="Notes" span2>
            <input className="input" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
          </FormField>
        </FormGrid>
      </Modal>
    </div>
  );
}
