import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useToday } from '../../hooks/useToday';
import { CompaniesView } from '../companies/CompaniesView';
import { subscriptionGroupOf } from '../../services/billingService';
import { COLLECTIONS, type Company } from '../../types/models';
import { refreshEmailVerified, sendMyEmailVerification } from '../../services/userAuthService';
import { applyBrandTheme } from '../../utils/brandTheme';
import { PLATFORM_BRAND } from '../../config/platformBrand';
import { PlatformAdminsView } from './PlatformAdminsView';
import { PlatformDashboard } from './PlatformDashboard';
import { PlatformView } from './PlatformView';
import './PlatformConsole.css';

type ConsoleSection = 'dashboard' | 'subscriptions' | 'companies' | 'admins';

const ICON_PROPS = { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 };

const CONSOLE_SECTIONS: Array<{ id: ConsoleSection; label: string; icon: ReactNode }> = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18M7 15h4" />
      </svg>
    ),
  },
  {
    id: 'companies',
    label: 'Companies',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5" />
      </svg>
    ),
  },
  {
    id: 'admins',
    label: 'Administrators',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 3l7 3v5c0 4.4-2.9 8.2-7 10-4.1-1.8-7-5.6-7-10V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
];

interface ConsoleSidebarProps {
  active: ConsoleSection;
  /** Empresas que piden accion (por vencer, vencidas, pendientes): pastilla en Subscriptions. */
  attention: number;
  onSelect: (section: ConsoleSection) => void;
}

/** Menu lateral del Admin Panel (en pantallas chicas pasa a una fila arriba). */
const ConsoleSidebar = ({ active, attention, onSelect }: ConsoleSidebarProps) => (
  <nav className="console__nav" aria-label="Admin Panel">
    {CONSOLE_SECTIONS.map((section) => (
      <button
        key={section.id}
        type="button"
        className={`console__nav-item${active === section.id ? ' console__nav-item--active' : ''}`}
        aria-current={active === section.id ? 'page' : undefined}
        onClick={() => onSelect(section.id)}
      >
        <span className="console__nav-icon" aria-hidden="true">{section.icon}</span>
        <span className="console__nav-label">{section.label}</span>
        {section.id === 'subscriptions' && attention > 0 && (
          <span className="console__nav-badge" title="Expiring soon, expired or pending approval">{attention}</span>
        )}
      </button>
    ))}
  </nav>
);

const CONSOLE_TITLE = `${PLATFORM_BRAND.name} · Admin Panel`;

/**
 * El Admin Panel exige el email verificado (las reglas tambien): asi nadie entra
 * creando una cuenta con el correo de un administrador.
 */
const EmailVerificationGate = () => {
  const { firebaseUser } = useAuth();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSend = async () => {
    setError(null);
    setBusy(true);
    try {
      await sendMyEmailVerification();
      setNotice(`We sent a verification link to ${firebaseUser?.email ?? 'your email'}. Open it, then press "I verified it".`);
    } catch {
      setError('The email could not be sent. Wait a minute and try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleCheck = async () => {
    setError(null);
    setBusy(true);
    try {
      if (await refreshEmailVerified()) {
        window.location.reload();
        return;
      }
      setError('The email is not verified yet. Open the link we sent and try again.');
    } catch {
      setError('Could not check the verification. Try again.');
    }
    setBusy(false);
  };

  return (
    <section className="console__verify">
      <h2 className="console__verify-title">Verify your email</h2>
      <p className="console__verify-text">
        The Admin Panel is only available with a verified email. Send yourself the link, open it, and come back.
      </p>
      {notice && <div className="console__message console__message--ok">{notice}</div>}
      {error && <div className="console__message console__message--error">{error}</div>}
      <div className="console__verify-actions">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleSend()}>
          Send verification email
        </button>
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void handleCheck()}>
          I verified it
        </button>
      </div>
    </section>
  );
};

/**
 * Admin Panel de la plataforma, fuera de toda empresa: no usa el menu ni la marca
 * de ninguna empresa. Se abre desde el paso "Company" del login (opcion "Admin Panel").
 */
export const PlatformConsole = () => {
  const { firebaseUser, isPlatformAdmin, platformNeedsVerification, logout } = useAuth();
  const today = useToday();
  const { data: companies } = useCollection<Company>(COLLECTIONS.COMPANIES);
  const [section, setSection] = useState<ConsoleSection>('dashboard');

  const attention = useMemo(
    () => companies.filter((company) => ['expiring', 'expired', 'pending'].includes(subscriptionGroupOf(company))).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- today fuerza el recalculo diario
    [companies, today],
  );

  /* Colores originales de la plataforma: no hereda los de la ultima empresa abierta. */
  useEffect(() => {
    applyBrandTheme(undefined);
  }, []);

  useEffect(() => {
    document.title = CONSOLE_TITLE;
  }, []);

  const handleSignOut = () => void logout();

  const handleSelectSection = (next: ConsoleSection) => {
    setSection(next);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="console">
      <header className="console__bar">
        <span className="console__brand">
          <span className="console__logo">
            <img className="console__logo-img" src={PLATFORM_BRAND.logo} alt={PLATFORM_BRAND.name} />
          </span>
          <span className="console__brand-sub">Admin Panel</span>
        </span>
        <span className="console__user">
          <span className="console__email">{firebaseUser?.email}</span>
          <button type="button" className="btn btn--secondary" onClick={handleSignOut}>
            Sign out
          </button>
        </span>
      </header>

      {platformNeedsVerification && (
        <main className="console__content">
          <EmailVerificationGate />
        </main>
      )}

      {!isPlatformAdmin && !platformNeedsVerification && (
        <main className="console__content">
          <p className="console__denied">Only platform administrators can open the Admin Panel.</p>
        </main>
      )}

      {isPlatformAdmin && (
        <div className="console__body">
          <ConsoleSidebar active={section} attention={attention} onSelect={handleSelectSection} />
          <main className="console__content">
            {section === 'dashboard' && <PlatformDashboard onOpenSubscriptions={() => handleSelectSection('subscriptions')} />}
            {section === 'subscriptions' && <PlatformView />}
            {section === 'companies' && <CompaniesView />}
            {section === 'admins' && <PlatformAdminsView />}
          </main>
        </div>
      )}
    </div>
  );
};
