import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getCompanyBrands } from '../../services/companyBrandService';
import type { CompanyBrand } from '../../types/models';
import './CompanyChooser.css';

/**
 * El email pertenece a varias empresas: se elige en cual entrar.
 * Cada membresia es un documento propio de system_users, con su rol.
 */
export function CompanyChooser() {
  const { memberships, chooseCompany, logout, profile } = useAuth();
  const [brands, setBrands] = useState<Record<string, CompanyBrand>>({});
  const [selected, setSelected] = useState('');

  const companyIds = memberships.map((m) => m.companyId ?? '').filter(Boolean);

  const companyKey = companyIds.join(',');

  /* Nombre y logo de cada empresa donde tiene acceso. */
  useEffect(() => {
    if (!companyKey) return;
    let cancelled = false;
    const loadBrands = async () => {
      const found = await getCompanyBrands(companyKey.split(','));
      if (!cancelled) setBrands(found);
    };
    void loadBrands();
    return () => {
      cancelled = true;
    };
  }, [companyKey]);

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
            const brand = brands[id];
            const companyName = brand?.name || `Company ${id.slice(0, 6)}`;
            return (
              <button
                key={m.id}
                type="button"
                className={`chooser__option${selected === id ? ' chooser__option--active' : ''}`}
                onClick={() => setSelected(id)}
              >
                <span className="chooser__option-brand">
                  {brand?.logo ? (
                    <img className="chooser__option-logo" src={brand.logo} alt="" />
                  ) : (
                    <span className="chooser__option-initial" aria-hidden="true">{companyName.charAt(0)}</span>
                  )}
                  <span className="chooser__option-name">{companyName}</span>
                </span>
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
