import { useState, type CSSProperties } from 'react';
import { useAuth } from '../../context/AuthContext';
import { PLATFORM_BRAND } from '../../config/platformBrand';
import { LoginCompanyStep } from './LoginCompanyStep';
import './LoginView.css';

/** Columnas decorativas del panel de marca (las mismas de la landing). */
const BRAND_PILLARS = [0, 1, 2, 3, 4, 5];

/** Orden de cada columna: escalona su animacion (valor en tiempo de ejecucion). */
const pillarStyle = (index: number): CSSProperties => ({ '--i': index }) as CSSProperties;

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Please try again in a few minutes.',
  'auth/user-disabled': 'This account has been disabled. Contact your administrator.',
};

interface LoginViewProps {
  /** Va al registro de empresa ("Register your company"). */
  onRegister: () => void;
  /** Vuelve a la landing page. */
  onHome: () => void;
}

/**
 * Login con la marca de la plataforma (Integrated Results). El logo de la empresa
 * aparece al entrar a ella (menu lateral), no aqui.
 */
export function LoginView({ onRegister, onHome }: LoginViewProps) {
  const { firebaseUser, login, resetPassword } = useAuth();
  /* Email y contrasena ya validados: falta confirmar la empresa. */
  const companyStep = !!firebaseUser;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    /* Vigilante: si la red o Firebase no responden, el boton no se queda colgado. */
    const watchdog = window.setTimeout(() => {
      setBusy(false);
      setError('This is taking longer than usual. Check your connection and try again.');
    }, 15000);
    try {
      await login(email, password);
      /* Exito: el login pasa al paso "Company". */
      window.clearTimeout(watchdog);
      setBusy(false);
    } catch (err) {
      window.clearTimeout(watchdog);
      const code = (err as { code?: string }).code ?? '';
      setError(ERROR_MESSAGES[code] ?? 'Could not sign in. Please try again.');
      setBusy(false);
    }
  };

  const handleForgot = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError('Enter your email above and click "Forgot password?" again.');
      return;
    }
    try {
      await resetPassword(email);
      setNotice(`Password reset link sent to ${email.trim()}.`);
    } catch {
      setError('Could not send the reset email. Check the address and try again.');
    }
  };


  return (
    <div className="login">
      <div className="login__card">
        <section className="login__form-panel">
          <h1 className="login__title">Sign In</h1>
          <p className="login__hint">
            {companyStep ? 'Confirm the company you are signing in to' : 'Sign in with your email & password'}
          </p>

          {companyStep ? (
            <LoginCompanyStep />
          ) : (
            <>
            <label className="login__label" htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="login__input"
              type="email"
              autoComplete="email"
              placeholder="Enter e-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleSubmit()}
            />

            <label className="login__label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="login__input"
              type="password"
              autoComplete="current-password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleSubmit()}
            />

            <button type="button" className="login__forgot" onClick={() => void handleForgot()}>
              Forgot password?
            </button>

            {error && <div className="login__message login__message--error">{error}</div>}
            {notice && <div className="login__message login__message--ok">{notice}</div>}

            <button
              type="button"
              className="login__submit"
              disabled={busy}
              onClick={() => void handleSubmit()}
            >
              {busy ? 'Checking…' : 'Continue'}
            </button>

            <button type="button" className="login__signup" onClick={onRegister}>
              Register your company
            </button>

            <button type="button" className="login__home" onClick={onHome}>
              &larr; Back to home
            </button>
            </>
          )}
        </section>

        <section className="login__brand-panel">
          <span className="login__pillars" aria-hidden="true">
            {BRAND_PILLARS.map((index) => (
              <span key={index} className="login__pillar" style={pillarStyle(index)} />
            ))}
          </span>
          <img className="login__platform-logo" src={PLATFORM_BRAND.logoWhite} alt={PLATFORM_BRAND.name} />
          <p className="login__brand-text">
            Purchases, sales, invoices and accounting in one secure system
            <span className="login__lime"> {'\u2014'} without spreadsheets or paperwork chaos.</span>
          </p>
          <p className="login__brand-note">
            Joining a team? Ask your administrator for an invitation. New company? Register it here.
          </p>
        </section>
      </div>
    </div>
  );
}
