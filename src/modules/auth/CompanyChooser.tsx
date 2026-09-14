import { useEffect, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { COLLECTIONS, type Company } from '../../types/models';
import './CompanyChooser.css';

/**
 * El email pertenece a varias empresas: se elige en cual entrar.
 * Cada membresia es un documento propio de system_users, con su rol.
 */
export function CompanyChooser() {
  const { memberships, chooseCompany, logout, profile } = useAuth();
  const [names, setNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState('');

  const companyIds = memberships.map((m) => m.companyId ?? '').filter(Boolean);

  /* Nombres de las empresas donde tiene acceso. */
  useEffect(() => {
    if (companyIds.length === 0) return;
    void getDocs(
      query(collection(db, COLLECTIONS.COMPANIES), where(documentId(), 'in', companyIds.slice(0, 10))),
    )
      .then((snap) => {
        const map: Record<string, string> = {};
        for (const d of snap.docs) map[d.id] = (d.data() as Company).name ?? d.id;
        setNames(map);
      })
      .catch(() => setNames({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIds.join(',')]);

  return (
    <div className="chooser">
      <div className="chooser__card">
        <h1 className="chooser__title">Choose your company</h1>
        <p className="chooser__hint">
          {profile?.email ? <b>{profile.email}</b> : 'Your account'} has access to more than one company.
          Pick the one you want to work in.
        </p>

        <div className="chooser__list">
          {memberships.map((m) => {
            const id = m.companyId ?? '';
            if (!id) return null;
            return (
              <button
                key={m.id}
                type="button"
                className={`chooser__option${selected === id ? ' chooser__option--active' : ''}`}
                onClick={() => setSelected(id)}
              >
                <span className="chooser__option-name">{names[id] ?? 'Company'}</span>
                <span className="chooser__option-role">{m.status === 'Inactive' ? 'Inactive' : 'Active'}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="chooser__submit"
          disabled={!selected}
          onClick={() => chooseCompany(selected)}
        >
          Continue
        </button>

        <button type="button" className="chooser__back" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
