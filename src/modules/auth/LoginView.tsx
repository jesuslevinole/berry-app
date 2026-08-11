import { useState } from 'react';
import { useCompany } from '../../hooks/useCompany';
import { useAuth } from '../../context/AuthContext';
import './LoginView.css';

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Please try again in a few minutes.',
  'auth/user-disabled': 'This account has been disabled. Contact your administrator.',
};

export function LoginView() {
  const { company } = useCompany();
  const { login, resetPassword, enterAsGuest } = useAuth();
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
    try {
      await login(email, password);
    } catch (err) {
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
          <p className="login__hint">Sign in with your email &amp; password</p>

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
            {busy ? 'Signing in…' : 'Sign In'}
          </button>

          <button type="button" className="login__bypass" onClick={enterAsGuest}>
            Enter without signing in (dev)
          </button>
        </section>

        <section className="login__brand-panel">
          {company.logo ? (
            <span className="login__logo login__logo--img" aria-hidden="true">
              <img className="login__logo-img" src={company.logo} alt="" />
            </span>
          ) : (
            <span className="login__logo" aria-hidden="true">{(company.name || 'B').charAt(0)}</span>
          )}
          <h2 className="login__brand-title">{company.name || 'Berry Source'}</h2>
          <p className="login__brand-sub">Operations</p>
          <p className="login__brand-text">
            Purchase orders, sales desk, expenses and catalogs — all in one place.
          </p>
          <p className="login__brand-note">
            Access is by invitation. If you need an account, contact your administrator.
          </p>
        </section>
      </div>
    </div>
  );
}
