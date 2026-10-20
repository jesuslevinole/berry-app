import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Toolbar } from '../../components/ui/Toolbar';
import { addPlatformAdmin, listPlatformAdmins, removePlatformAdmin } from '../../services/platformAdminService';
import { isPlatformAdminEmail, PLATFORM_ADMIN_EMAILS } from '../../services/tenant';
import { fmtDate } from '../../utils/format';
import type { PlatformAdmin } from '../../types/models';
import './PlatformAdminsView.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Quienes pueden entrar al Admin Panel. Los duenos fijos no se pueden quitar y son
 * los unicos que agregan o quitan administradores (lo mismo exigen las reglas).
 */
export const PlatformAdminsView = () => {
  const { firebaseUser } = useAuth();
  const myEmail = firebaseUser?.email?.toLowerCase() ?? '';
  const isOwner = isPlatformAdminEmail(myEmail);
  const [admins, setAdmins] = useState<PlatformAdmin[] | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* Lista de administradores agregados (coleccion diminuta, lectura puntual). */
  useEffect(() => {
    let cancelled = false;
    const loadAdmins = async () => {
      try {
        const found = await listPlatformAdmins();
        if (!cancelled) setAdmins(found);
      } catch {
        if (!cancelled) setError('Could not load the administrators. Check your connection and try again.');
      }
    };
    void loadAdmins();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAdd = async () => {
    const clean = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(clean)) return setError('Enter a valid email address.');
    if (isPlatformAdminEmail(clean) || admins?.some((admin) => admin.email === clean)) {
      return setError('That email is already an administrator.');
    }
    setError(null);
    setBusy(true);
    try {
      await addPlatformAdmin(clean, myEmail);
      setAdmins(await listPlatformAdmins());
      setEmail('');
    } catch {
      setError('The administrator could not be added. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (admin: PlatformAdmin) => {
    if (!window.confirm(`Remove ${admin.email}? They will lose access to the Admin Panel.`)) return;
    setBusy(true);
    try {
      await removePlatformAdmin(admin.email);
      setAdmins(await listPlatformAdmins());
    } catch {
      setError('The administrator could not be removed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="platform-admins">
      <Toolbar title="Administrators" subtitle="People who can open the Admin Panel" />

      {isOwner && (
        <div className="platform-admins__add">
          <input
            className="input platform-admins__input"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleAdd()}
          />
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleAdd()}>
            Add administrator
          </button>
        </div>
      )}
      {error && <div className="platform-admins__error">{error}</div>}

      <div className="platform-admins__card">
        <ul className="platform-admins__list">
          {PLATFORM_ADMIN_EMAILS.map((ownerEmail) => (
            <li key={ownerEmail} className="platform-admins__item">
              <span className="platform-admins__email">{ownerEmail}</span>
              <span className="platform-admins__badge">Owner</span>
            </li>
          ))}
          {admins?.map((admin) => (
            <li key={admin.id} className="platform-admins__item">
              <span className="platform-admins__email">{admin.email}</span>
              <span className="platform-admins__meta">
                Added by {admin.addedBy || '—'} on {fmtDate(admin.addedAt?.slice(0, 10))}
              </span>
              {isOwner && (
                <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void handleRemove(admin)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <p className="platform-admins__hint">
        A new administrator signs in with that email (an account must exist, e.g. invited to any company or
        registered) and must verify it the first time they open the Admin Panel.
      </p>
    </div>
  );
};
