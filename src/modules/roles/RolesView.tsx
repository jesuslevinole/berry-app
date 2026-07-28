import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import { COLLECTIONS, type AppRole, type ModulePermission, type SystemUser } from '../../types/models';
import { MODULE_DEFS, buildEmptyPermissions, mergePermissions } from '../../config/modules';
import { Toolbar } from '../../components/ui/Toolbar';
import './RolesView.css';

interface RoleDraft {
  id: string;
  name: string;
  description: string;
  permissions: ModulePermission[];
}

const EMPTY_DRAFT = (): RoleDraft => ({
  id: '',
  name: '',
  description: '',
  permissions: buildEmptyPermissions(),
});

export function RolesView() {
  const { can } = useAuth();
  const { data: roles, loading } = useCollection<AppRole>(COLLECTIONS.ROLES);
  const { data: users } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<RoleDraft>(EMPTY_DRAFT());

  const rows = useMemo(
    () => [...roles].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [roles],
  );

  const usersPerRole = useMemo(() => {
    const map = new Map<string, number>();
    for (const user of users) map.set(user.roleId, (map.get(user.roleId) ?? 0) + 1);
    return map;
  }, [users]);

  const openCreate = () => {
    setDraft(EMPTY_DRAFT());
    setModalOpen(true);
  };

  const openEdit = (role: AppRole) => {
    setDraft({
      id: role.id,
      name: role.name ?? '',
      description: role.description ?? '',
      permissions: mergePermissions(role.permissions),
    });
    setModalOpen(true);
  };

  const setPermission = (moduleId: string, field: keyof Omit<ModulePermission, 'module'>, value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      permissions: prev.permissions.map((p) =>
        p.module === moduleId ? { ...p, [field]: value } : p,
      ),
    }));
  };

  const setRowAll = (moduleId: string, value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      permissions: prev.permissions.map((p) =>
        p.module === moduleId
          ? { module: p.module, canView: value, canAdd: value, canEdit: value, canDelete: value, canDocuments: value }
          : p,
      ),
    }));
  };

  const setAll = (value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      permissions: prev.permissions.map((p) => ({
        module: p.module,
        canView: value,
        canAdd: value,
        canEdit: value,
        canDelete: value,
        canDocuments: value,
      })),
    }));
  };

  /** Cierre inmediato: la escritura corre en segundo plano (Firestore es local-first). */
  const handleSave = () => {
    const name = draft.name.trim();
    if (!name) {
      alert('Role name is required.');
      return;
    }
    const payload = {
      name,
      description: draft.description.trim(),
      permissions: draft.permissions,
    };
    const editingId = draft.id;
    setModalOpen(false);
    const persist = editingId
      ? updateDocument<AppRole>(COLLECTIONS.ROLES, editingId, payload)
      : createDocument<AppRole>(COLLECTIONS.ROLES, payload as Omit<AppRole, 'id'>);
    persist.catch((error: unknown) =>
      alert(`Failed to save role: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  const handleDelete = () => {
    if (!draft.id) return;
    const inUse = usersPerRole.get(draft.id) ?? 0;
    if (inUse > 0) {
      alert(`This role is assigned to ${inUse} user(s). Reassign them before deleting.`);
      return;
    }
    if (!window.confirm(`Delete role "${draft.name}"?`)) return;
    const id = draft.id;
    setModalOpen(false);
    deleteDocument(COLLECTIONS.ROLES, id).catch((error: unknown) =>
      alert(`Failed to delete role: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  const countGranted = (role: AppRole): number =>
    (role.permissions ?? []).filter((p) => p.canView).length;

  return (
    <div className="roles">
      <Toolbar title="Roles & Permissions" subtitle={`${rows.length} roles`}>
        {can('roles', 'add') && (
          <button type="button" className="btn btn--primary" onClick={openCreate}>+ Add role</button>
        )}
      </Toolbar>

      <div className="roles__card">
        <table className="roles__table">
          <thead>
            <tr>
              <th className="roles__th">Role</th>
              <th className="roles__th">Description</th>
              <th className="roles__th roles__th--center">Modules visible</th>
              <th className="roles__th roles__th--center">Users</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td className="roles__empty" colSpan={4}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td className="roles__empty" colSpan={4}>No roles yet. Create the first one.</td></tr>
            )}
            {!loading && rows.map((role) => (
              <tr
                key={role.id}
                className="roles__row"
                onClick={() => (can('roles', 'edit') || can('roles', 'view')) && openEdit(role)}
              >
                <td className="roles__td roles__td--name">{role.name}</td>
                <td className="roles__td roles__td--muted">{role.description || '—'}</td>
                <td className="roles__td roles__td--center">{countGranted(role)} / {MODULE_DEFS.length}</td>
                <td className="roles__td roles__td--center">{usersPerRole.get(role.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="roles__overlay" onClick={() => setModalOpen(false)}>
          <div className="roles__modal" onClick={(e) => e.stopPropagation()}>
            <header className="roles__modal-header">
              <h3 className="roles__modal-title">{draft.id ? 'Edit role' : 'New role'}</h3>
              <button type="button" className="roles__modal-close" onClick={() => setModalOpen(false)} aria-label="Close">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </header>

            <div className="roles__modal-body">
              <div className="roles__form-grid">
                <div>
                  <label className="roles__label" htmlFor="role-name">Role name</label>
                  <input
                    id="role-name"
                    className="roles__input"
                    value={draft.name}
                    placeholder="e.g. Administrator, Sales, Warehouse"
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="roles__label" htmlFor="role-desc">Description</label>
                  <input
                    id="role-desc"
                    className="roles__input"
                    value={draft.description}
                    placeholder="What can this role do?"
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  />
                </div>
              </div>

              <div className="roles__matrix-header">
                <h4 className="roles__section-title">Permissions per module</h4>
                <div className="roles__chip-row">
                  <button type="button" className="roles__chip roles__chip--primary" onClick={() => setAll(true)}>Grant all</button>
                  <button type="button" className="roles__chip" onClick={() => setAll(false)}>Clear all</button>
                </div>
              </div>
              <p className="roles__matrix-hint">
                <strong>View</strong> shows the module in the menu. <strong>Documents</strong> allows Excel export,
                templates and CSV import. Click a module name to toggle its whole row.
              </p>

              <div className="roles__matrix-card">
                <table className="roles__matrix">
                  <thead>
                    <tr>
                      <th className="roles__th">Module</th>
                      <th className="roles__th roles__th--center">View</th>
                      <th className="roles__th roles__th--center">Add</th>
                      <th className="roles__th roles__th--center">Edit</th>
                      <th className="roles__th roles__th--center">Delete</th>
                      <th className="roles__th roles__th--center">Documents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.permissions.map((perm) => {
                      const def = MODULE_DEFS.find((m) => m.id === perm.module);
                      const fullRow = perm.canView && perm.canAdd && perm.canEdit && perm.canDelete
                        && (!def?.hasDocuments || perm.canDocuments);
                      return (
                        <tr key={perm.module}>
                          <td
                            className="roles__td roles__td--name roles__td--clickable"
                            onClick={() => setRowAll(perm.module, !fullRow)}
                            title="Toggle whole row"
                          >
                            {def?.label ?? perm.module}
                          </td>
                          <td className="roles__td roles__td--center">
                            <input type="checkbox" className="roles__checkbox" checked={perm.canView}
                              onChange={(e) => setPermission(perm.module, 'canView', e.target.checked)} />
                          </td>
                          <td className="roles__td roles__td--center">
                            <input type="checkbox" className="roles__checkbox" checked={perm.canAdd}
                              onChange={(e) => setPermission(perm.module, 'canAdd', e.target.checked)} />
                          </td>
                          <td className="roles__td roles__td--center">
                            <input type="checkbox" className="roles__checkbox" checked={perm.canEdit}
                              onChange={(e) => setPermission(perm.module, 'canEdit', e.target.checked)} />
                          </td>
                          <td className="roles__td roles__td--center">
                            <input type="checkbox" className="roles__checkbox" checked={perm.canDelete}
                              onChange={(e) => setPermission(perm.module, 'canDelete', e.target.checked)} />
                          </td>
                          <td className="roles__td roles__td--center">
                            {def?.hasDocuments ? (
                              <input type="checkbox" className="roles__checkbox" checked={perm.canDocuments}
                                onChange={(e) => setPermission(perm.module, 'canDocuments', e.target.checked)} />
                            ) : (
                              <span className="roles__na">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <footer className="roles__modal-footer">
              {draft.id && can('roles', 'delete') && (
                <button type="button" className="btn btn--danger roles__footer-left" onClick={handleDelete}>Delete</button>
              )}
              <button type="button" className="btn btn--secondary" onClick={() => setModalOpen(false)}>Cancel</button>
              {(draft.id ? can('roles', 'edit') : can('roles', 'add')) && (
                <button type="button" className="btn btn--primary" onClick={handleSave}>Save role</button>
              )}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
