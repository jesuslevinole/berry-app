import { useState } from 'react';
import { signUpCompany, type SignupData } from '../../services/signupService';
import { TRIAL_DAYS } from '../../services/billingService';
import './SignupView.css';

const emptyForm: SignupData = {
  companyName: '',
  companyCode: '',
  logo: '',
  firstName: '',
  lastName: '',
  email: '',
  password: '',
};

interface Props {
  onBack: () => void;
}

/**
 * Alta publica: la empresa se registra sola con su nombre, logo y usuario
 * dueno, y arranca con la prueba gratuita. Al terminar entra directo a la app.
 */
export function SignupView({ onBack }: Props) {
  const [form, setForm] = useState<SignupData>(emptyForm);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (part: Partial<SignupData>) => setForm((f) => ({ ...f, ...part }));

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 400_000) {
      setError('The logo must be smaller than 400 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => patch({ logo: String(reader.result ?? '') });
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setError(null);
    if (!form.companyName.trim()) return setError('Enter the company name.');
    if (!form.firstName.trim() || !form.lastName.trim()) return setError('Enter your first and last name.');
    if (!form.email.trim()) return setError('Enter your email.');
    if (form.password.length < 6) return setError('The password needs at least 6 characters.');
    if (form.password !== confirm) return setError('The passwords do not match.');

    setBusy(true);
    try {
      await signUpCompany(form);
      /* La sesion ya quedo iniciada: recargar entra directo a la empresa nueva. */
      window.location.reload();
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/email-already-in-use') {
        setError('That email already has an account. Sign in instead, or use another address.');
      } else if (code === 'auth/weak-password') {
        setError('The password is too weak. Use at least 6 characters.');
      } else if (code === 'permission-denied') {
        setError('The account was created but the company could not be set up. Contact support.');
      } else {
        setError('The company could not be registered. Try again.');
      }
      setBusy(false);
    }
  };

  return (
    <div className="signup">
      <div className="signup__card">
        <h1 className="signup__title">Create your company</h1>
        <p className="signup__hint">
          {TRIAL_DAYS} days free. No card required: your data stays private to your company from the
          first day.
        </p>

        <div className="signup__grid">
          <label className="signup__field signup__field--wide">
            <span className="signup__label">Company name</span>
            <input className="signup__input" value={form.companyName} onChange={(e) => patch({ companyName: e.target.value })} />
          </label>

          <label className="signup__field">
            <span className="signup__label">Short code</span>
            <input className="signup__input" value={form.companyCode} placeholder="Optional" onChange={(e) => patch({ companyCode: e.target.value })} />
          </label>

          <label className="signup__field">
            <span className="signup__label">Logo</span>
            <input className="signup__input signup__input--file" type="file" accept="image/*" onChange={(e) => pickLogo(e.target.files?.[0])} />
          </label>

          {form.logo && (
            <div className="signup__logo-preview">
              <img src={form.logo} alt="Company logo" />
            </div>
          )}

          <label className="signup__field">
            <span className="signup__label">First name</span>
            <input className="signup__input" value={form.firstName} onChange={(e) => patch({ firstName: e.target.value })} />
          </label>

          <label className="signup__field">
            <span className="signup__label">Last name</span>
            <input className="signup__input" value={form.lastName} onChange={(e) => patch({ lastName: e.target.value })} />
          </label>

          <label className="signup__field signup__field--wide">
            <span className="signup__label">Email</span>
            <input className="signup__input" type="email" autoComplete="email" value={form.email} onChange={(e) => patch({ email: e.target.value })} />
          </label>

          <label className="signup__field">
            <span className="signup__label">Password</span>
            <input className="signup__input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => patch({ password: e.target.value })} />
          </label>

          <label className="signup__field">
            <span className="signup__label">Repeat password</span>
            <input
              className="signup__input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </label>
        </div>

        {error && <div className="signup__message">{error}</div>}

        <button type="button" className="signup__submit" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Creating your company\u2026' : `Start my ${TRIAL_DAYS}-day free trial`}
        </button>

        <button type="button" className="signup__back" onClick={onBack}>
          I already have an account
        </button>

        <p className="signup__note">
          You become the owner of the company: you can invite your team and set their roles from
          System Users once you are inside.
        </p>
      </div>
    </div>
  );
}
