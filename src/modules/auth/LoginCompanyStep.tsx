import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getCompanyBrands, listCompanyIds } from '../../services/companyBrandService';
import { clearPublicPage } from '../../hooks/usePublicPage';
import type { CompanyBrand } from '../../types/models';
import './LoginCompanyStep.css';

const companyLabel = (brand: CompanyBrand): string => brand.name || `Company ${brand.companyId.slice(0, 6)}`;

/** Opcion del Admin Panel (fuera de toda empresa); solo para administradores de la plataforma. */
const CONSOLE_OPTION = '__platform__';

interface CompanyOption {
  id: string;
  label: string;
}

/**
 * Segundo paso del login: el email y la contrasena ya se validaron; aqui se
 * confirma la empresa. Con una sola empresa se muestra como texto; con varias,
 * como lista. La empresa solo se cambia desde aqui (cerrando sesion).
 */
export const LoginCompanyStep = () => {
  const { firebaseUser, loading, isPlatformAdmin, platformNeedsVerification, memberships, chooseCompany, chooseConsole, logout } =
    useAuth();
  /* Si su email aun no esta verificado, el Admin Panel se lo pide al entrar. */
  const canOpenConsole = isPlatformAdmin || platformNeedsVerification;
  const [brands, setBrands] = useState<CompanyBrand[] | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);

  /* Membresias activas; el admin de plataforma ve todas las empresas. */
  const memberKey = memberships
    .filter((m) => m.status !== 'Inactive')
    .map((m) => m.companyId ?? '')
    .filter(Boolean)
    .join(',');

  /* Nombre y logo de cada empresa disponible (cuando el perfil termino de cargar). */
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const loadBrands = async () => {
      try {
        const ids = isPlatformAdmin ? await listCompanyIds() : memberKey.split(',').filter(Boolean);
        const found = Object.values(await getCompanyBrands(ids));
        found.sort((a, b) => companyLabel(a).localeCompare(companyLabel(b)));
        if (cancelled) return;
        setBrands(found);
      } catch {
        if (cancelled) return;
        /* El admin de plataforma puede entrar al Admin Panel aunque no se pueda leer la lista. */
        if (canOpenConsole) setBrands([]);
        else setError('Could not load your companies. Check your connection and try again.');
      }
    };
    void loadBrands();
    return () => {
      cancelled = true;
    };
  }, [loading, isPlatformAdmin, canOpenConsole, memberKey]);

  /* El Admin Panel va primero: no es una empresa, es la consola de la plataforma. */
  const options: CompanyOption[] | null = brands && [
    ...(canOpenConsole ? [{ id: CONSOLE_OPTION, label: 'Admin Panel (platform)' }] : []),
    ...brands.map((brand) => ({ id: brand.companyId, label: companyLabel(brand) })),
  ];
  const selectedId = selected || (options?.length === 1 ? options[0].id : '');

  const handleSelect = (optionId: string) => {
    setSelected(optionId);
  };

  const handleSignIn = () => {
    if (!selectedId) {
      setError('Select the company you want to sign in to.');
      return;
    }
    clearPublicPage();
    if (selectedId === CONSOLE_OPTION) chooseConsole();
    else chooseCompany(selectedId);
  };

  const handleUseAnotherAccount = () => {
    void logout();
  };

  const renderCompanyField = () => {
    if (!options) {
      return (
        <input
          id="login-company"
          className="login__input login-company__input--locked"
          type="text"
          readOnly
          value="Checking your companies…"
        />
      );
    }
    if (options.length === 1) {
      return (
        <input
          id="login-company"
          className="login__input login-company__input--locked"
          type="text"
          readOnly
          value={options[0].label}
        />
      );
    }
    return (
      <select
        id="login-company"
        className="login__input login-company__select"
        value={selectedId}
        onChange={(e) => handleSelect(e.target.value)}
      >
        <option value="" disabled>Select a company</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    );
  };

  const noCompanies = !!options && options.length === 0;

  return (
    <>
      <label className="login__label" htmlFor="login-email-locked">Email</label>
      <input
        id="login-email-locked"
        className="login__input login-company__input--locked"
        type="email"
        readOnly
        value={firebaseUser?.email ?? ''}
      />

      <label className="login__label" htmlFor="login-company">Company</label>
      {renderCompanyField()}

      {noCompanies && (
        <div className="login__message login__message--error">
          This email does not have access to any active company. Contact your administrator.
        </div>
      )}
      {error && <div className="login__message login__message--error">{error}</div>}

      <button type="button" className="login__submit" disabled={!selectedId} onClick={handleSignIn}>
        Sign In
      </button>

      <button type="button" className="login-company__back" onClick={handleUseAnotherAccount}>
        Use another account
      </button>
    </>
  );
};
