import { useMemo, useState } from 'react';
import { doc, deleteDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { COLLECTIONS, type AppRole, type SystemUser, type SystemUserStatus } from '../../types/models';
import { createUserWithResetEmail, resendPasswordReset } from '../../services/userAuthService';
import { Toolbar } from '../../components/ui/Toolbar';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import './UsersView.css';

/** Doc ID deterministico basado en email para usuarios aun sin cuenta de Auth. */
const emailToPendingId = (email: string): string =>
  `pending_${email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '_')}`;

interface UserDraft {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roleId: string;
  status: SystemUserStatus;
}

const STATUS_META: Record<SystemUserStatus, { label: string; className: string }> = {
  'Pending Invite': { label: 'Pending invite', className: 'pending' },
  Active: { label: 'Active', className: 'active' },
  Inactive: { label: 'Inactive', className: 'inactive' },
};

export function UsersView() {
  const { can, firebaseUser } = useAuth();
  const { data: users, loading } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  const { data: roles } = useCollection<AppRole>(COLLECTIONS.ROLES);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const rolesById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const sorted = [...users].sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
    );
    if (!term) return sorted;
    return sorted.filter((u) =>
      [`${u.firstName} ${u.lastName}`, u.email, rolesById.get(u.roleId)?.name ?? '']
        .some((v) => v.toLowerCase().includes(term)),
    );
  }, [users, search, rolesById]);

  const openCreate = () => {
    setDraft({
      id: '',
      firstName: '',
      lastName: '',
      email: '',
      roleId: roles[0]?.id ?? '',
      status: 'Pending Invite',
    });
    setModalOpen(true);
  };

  const openEdit = (user: SystemUser) => {
    setDraft({
      id: user.id,
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      email: user.email ?? '',
      roleId: user.roleId ?? '',
      status: user.status ?? 'Pending Invite',
    });
    setModalOpen(true);
  };

  /** Guardado con cierre inmediato: validaciones sincronas, escritura en segundo plano. */
  const handleSave = () => {
    if (!draft) return;
    const firstName = draft.firstName.trim();
    const email = draft.email.toLowerCase().trim();
    if (!firstName || !email || !draft.roleId) {
      alert('First name, email and role are required.');
      return;
    }
    if (!email.includes('@') || !email.includes('.')) {
      alert('Please enter a valid email address.');
      return;
    }
    const clash = users.find((u) => u.id !== draft.id && (u.email ?? '').toLowerCase().trim() === email);
    if (clash) {
      alert(`This email is already registered (${clash.firstName} ${clash.lastName}).`);
      return;
    }

    const editing = draft.id ? users.find((u) => u.id === draft.id) : undefined;
    const emailChanged = !!editing && (editing.email ?? '').toLowerCase().trim() !== email;
    setModalOpen(false);

    const persist = async () => {
      if (editing) {
        const payload: Partial<SystemUser> = {
          firstName,
          lastName: draft.lastName.trim(),
          email,
          roleId: draft.roleId,
          status: draft.status,
        };
        if (emailChanged) payload.inviteSent = false;

        if (emailChanged && editing.id.startsWith('pending_')) {
          /* Sin cuenta de Auth todavia: migrar el doc al nuevo ID deterministico. */
          const newId = emailToPendingId(email);
          const { id: _omit, ...base } = editing;
          void _omit;
          await setDoc(doc(db, COLLECTIONS.SYSTEM_USERS, newId), { ...base, ...payload });
          await deleteDoc(doc(db, COLLECTIONS.SYSTEM_USERS, editing.id));
          return;
        }
        await updateDoc(doc(db, COLLECTIONS.SYSTEM_USERS, editing.id), payload);
        if (emailChanged && editing.inviteSent) {
          alert(
            'Email changed for an already-invited user.\n\n' +
              '1) Use the send button to create access for the NEW email.\n' +
              '2) Delete the OLD email account in Firebase Console > Authentication to revoke it.',
          );
        }
        return;
      }

      /* Crear: solo Firestore. La cuenta de Auth se crea al enviar la invitacion. */
      const id = emailToPendingId(email);
      await setDoc(doc(db, COLLECTIONS.SYSTEM_USERS, id), {
        firstName,
        lastName: draft.lastName.trim(),
        email,
        roleId: draft.roleId,
        status: 'Pending Invite',
        inviteSent: false,
        createdAt: new Date().toISOString(),
      });
    };
    persist().catch((error: unknown) =>
      alert(`Failed to save user: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  const handleDelete = () => {
    if (!draft?.id) return;
    const user = users.find((u) => u.id === draft.id);
    if (user && firebaseUser?.email && user.email === firebaseUser.email.toLowerCase()) {
      alert('You cannot delete your own user.');
      return;
    }
    if (
      !window.confirm(
        'Delete this user from the system?\n\nNote: if they were already invited, their sign-in account must also be removed in Firebase Console > Authentication to fully revoke access.',
      )
    )
      return;
    const id = draft.id;
    setModalOpen(false);
    deleteDoc(doc(db, COLLECTIONS.SYSTEM_USERS, id)).catch((error: unknown) =>
      alert(`Failed to delete user: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  /** Enviar/reenviar invitacion: crea la cuenta de Auth y manda el enlace de contraseña. */
  const handleSendInvite = async (user: SystemUser) => {
    if (!user.email) return;
    const wasInvited = !!user.inviteSent;
    const msg = wasInvited
      ? `Resend the password setup email to ${user.email}?`
      : `Send invitation to ${user.email}?\n\nThis creates their sign-in account and emails them a link to set their password.`;
    if (!window.confirm(msg)) return;

    setSendingId(user.id);
    try {
      let finalId = user.id;
      if (wasInvited) {
        await resendPasswordReset(user.email);
      } else {
        const result = await createUserWithResetEmail(user.email);
        /* Migrar el doc pending_ al UID real de Auth para lookups consistentes. */
        if (result.uid && result.uid !== user.id) {
          const { id: _omit, ...base } = user;
          void _omit;
          await setDoc(doc(db, COLLECTIONS.SYSTEM_USERS, result.uid), {
            ...base,
            inviteSent: true,
            inviteSentAt: new Date().toISOString(),
          });
          await deleteDoc(doc(db, COLLECTIONS.SYSTEM_USERS, user.id));
          finalId = result.uid;
        }
      }
      if (finalId === user.id) {
        await updateDoc(doc(db, COLLECTIONS.SYSTEM_USERS, user.id), {
          inviteSent: true,
          inviteSentAt: new Date().toISOString(),
        });
      }
      alert(`Invitation email sent to ${user.email}.`);
    } catch (error) {
      alert(`Failed to send: ${(error as Error).message ?? 'Unknown error'}`);
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="users">
      <Toolbar
        title="System Users"
        subtitle={`${rows.length} users`}
        searchValue={search}
        onSearchChange={setSearch}
      >
        {can('users', 'add') && (
          <button type="button" className="btn btn--primary" onClick={openCreate}>+ Add user</button>
        )}
      </Toolbar>

      <div className="users__card">
        <table className="users__table">
          <thead>
            <tr>
              <th className="users__th">Name</th>
              <th className="users__th">Email</th>
              <th className="users__th">Role</th>
              <th className="users__th">Status</th>
              <th className="users__th users__th--right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td className="users__empty" colSpan={5}>Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td className="users__empty" colSpan={5}>No users yet. Add the first one.</td></tr>
            )}
            {!loading && rows.map((user) => {
              const meta = STATUS_META[user.status] ?? STATUS_META['Pending Invite'];
              const sending = sendingId === user.id;
              return (
                <tr key={user.id} className="users__row">
                  <td className="users__td users__td--strong">{user.firstName} {user.lastName}</td>
                  <td className="users__td users__td--muted">{user.email}</td>
                  <td className="users__td">
                    <span className="users__role-badge">{rolesById.get(user.roleId)?.name ?? '—'}</span>
                  </td>
                  <td className="users__td">
                    <span className="users__status">
                      <span className={`users__status-dot users__status-dot--${meta.className}`} />
                      <span className={`users__status-text users__status-text--${meta.className}`}>{meta.label}</span>
                    </span>
                  </td>
                  <td className="users__td users__td--right">
                    <span className="users__actions">
                      {can('users', 'edit') && (
                        <button
                          type="button"
                          className={`users__icon-btn users__icon-btn--send${sending ? ' users__icon-btn--busy' : ''}`}
                          title={user.inviteSent ? 'Resend password email' : 'Send invitation'}
                          disabled={sending}
                          onClick={() => void handleSendInvite(user)}
                        >
                          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                          </svg>
                        </button>
                      )}
                      {can('users', 'edit') && (
                        <button
                          type="button"
                          className="users__icon-btn users__icon-btn--edit"
                          title="Edit"
                          onClick={() => openEdit(user)}
                        >
                          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M17 3l4 4L8 20H4v-4L17 3z" />
                          </svg>
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modalOpen && draft && (
        <div className="users__overlay" onClick={() => setModalOpen(false)}>
          <div className="users__modal" onClick={(e) => e.stopPropagation()}>
            <header className="users__modal-header">
              <h3 className="users__modal-title">{draft.id ? 'Edit user' : 'New user'}</h3>
              <button type="button" className="users__modal-close" onClick={() => setModalOpen(false)} aria-label="Close">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </header>

            <div className="users__modal-body">
              {!draft.id && (
                <div className="users__banner">
                  Saving does <strong>not</strong> send any email. Use the send button in the list when
                  you are ready to invite them.
                </div>
              )}
              <div className="users__form-row">
                <div>
                  <label className="users__label" htmlFor="user-first">First name</label>
                  <input id="user-first" className="users__input" value={draft.firstName}
                    onChange={(e) => setDraft((d) => d && { ...d, firstName: e.target.value })} />
                </div>
                <div>
                  <label className="users__label" htmlFor="user-last">Last name</label>
                  <input id="user-last" className="users__input" value={draft.lastName}
                    onChange={(e) => setDraft((d) => d && { ...d, lastName: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="users__label" htmlFor="user-email">Email</label>
                <input id="user-email" className="users__input" type="email" value={draft.email}
                  onChange={(e) => setDraft((d) => d && { ...d, email: e.target.value })} />
              </div>
              <div className="users__form-row">
                <div>
                  <label className="users__label" htmlFor="user-role">Role</label>
                  <SearchableSelect
                    value={draft.roleId}
                    onChange={(id) => setDraft((d) => d && { ...d, roleId: id })}
                    options={roles.map((role) => ({ id: role.id, name: role.name }))}
                    placeholder="Select a role…"
                  />
                </div>
                <div>
                  <label className="users__label" htmlFor="user-status">Status</label>
                  <SearchableSelect
                    value={draft.status}
                    onChange={(id) => setDraft((d) => d && { ...d, status: (id || 'Pending Invite') as SystemUserStatus })}
                    options={[
                      { id: 'Pending Invite', name: 'Pending invite' },
                      { id: 'Active', name: 'Active' },
                      { id: 'Inactive', name: 'Inactive (blocks access)' },
                    ]}
                    placeholder="Status…"
                  />
                </div>
              </div>
              {roles.length === 0 && (
                <div className="users__banner users__banner--warning">
                  No roles exist yet. Create one in Roles &amp; Permissions first.
                </div>
              )}
            </div>

            <footer className="users__modal-footer">
              {draft.id && can('users', 'delete') && (
                <button type="button" className="btn btn--danger users__footer-left" onClick={handleDelete}>Delete</button>
              )}
              <button type="button" className="btn btn--secondary" onClick={() => setModalOpen(false)}>Cancel</button>
              {(draft.id ? can('users', 'edit') : can('users', 'add')) && (
                <button type="button" className="btn btn--primary" onClick={handleSave}>Save user</button>
              )}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
