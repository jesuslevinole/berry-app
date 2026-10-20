import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { BrandColorPicker } from '../company/BrandColorPicker';
import { signUpCompany, type SignupData } from '../../services/signupService';
import { applyBrandTheme } from '../../utils/brandTheme';
import { PLATFORM_BRAND } from '../../config/platformBrand';
import { clearPublicPage } from '../../hooks/usePublicPage';
import { TRIAL_DAYS, TRIAL_GRACE_DAYS, TRIAL_RECORD_LIMIT } from '../../services/trialLimits';
import './SignupView.css';

type SignupStep = 'company' | 'owner';

/** El logo se guarda como data URL dentro de la ficha (limite de 1 MB por documento). */
const MAX_LOGO_BYTES = 400_000;
const MIN_PASSWORD_LENGTH = 6;

const emptyForm: SignupData = {
  companyName: '',
  companyCode: '',
  address: '',
  cityStateZip: '',
  phone: '',
  logo: '',
  brandColor: '',
  firstName: '',
  lastName: '',
  email: '',
  password: '',
};

const ERROR_MESSAGES: Record<string, string> = {
  /* Correo que ya tiene cuenta (p. ej. usuario de otra empresa): pendiente crear la empresa desde adentro. */
  'auth/email-already-in-use': 'That email already has an account. Sign in with it instead, or use another address.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/weak-password': 'The password is too weak. Use at least 6 characters.',
  'permission-denied': 'The account was created but the company could not be set up. Contact support.',
};

interface SignupCompanyFieldsProps {
  form: SignupData;
  onChange: (part: Partial<SignupData>) => void;
  onLogoPick: (file: File | undefined) => void;
  onColorChange: (color: string) => void;
}

/** Paso 1: datos de la empresa (aparecen en el app y en los documentos). */
const SignupCompanyFields = ({ form, onChange, onLogoPick, onColorChange }: SignupCompanyFieldsProps) => (
  <div className="signup__grid">
    <label className="signup__field signup__field--wide">
      <span className="signup__label">Company legal name</span>
      <input className="signup__input" value={form.companyName} onChange={(e) => onChange({ companyName: e.target.value })} />
    </label>

    <label className="signup__field">
      <span className="signup__label">Short code</span>
      <input className="signup__input" value={form.companyCode} placeholder="Optional" onChange={(e) => onChange({ companyCode: e.target.value })} />
    </label>

    <label className="signup__field">
      <span className="signup__label">Phone</span>
      <input className="signup__input" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => onChange({ phone: e.target.value })} />
    </label>

    <label className="signup__field signup__field--wide">
      <span className="signup__label">Address</span>
      <input className="signup__input" autoComplete="street-address" value={form.address} onChange={(e) => onChange({ address: e.target.value })} />
    </label>

    <label className="signup__field signup__field--wide">
      <span className="signup__label">City, State ZIP</span>
      <input className="signup__input" placeholder="Killeen, TX 76541" value={form.cityStateZip} onChange={(e) => onChange({ cityStateZip: e.target.value })} />
    </label>

    <label className="signup__field signup__field--wide">
      <span className="signup__label">Logo</span>
      <input className="signup__input signup__input--file" type="file" accept="image/*" onChange={(e) => onLogoPick(e.target.files?.[0])} />
    </label>

    {form.logo && (
      <div className="signup__logo-preview">
        <img src={form.logo} alt="Company logo" />
      </div>
    )}

    <div className="signup__field signup__field--wide">
      <span className="signup__label">Brand color</span>
      <BrandColorPicker value={form.brandColor} onChange={onColorChange} />
    </div>
  </div>
);

interface SignupOwnerFieldsProps {
  form: SignupData;
  confirm: string;
  onChange: (part: Partial<SignupData>) => void;
  onConfirmChange: (value: string) => void;
  onSubmit: () => void;
}

/** Paso 2: cuenta del dueno (con ese email y contrasena entra al app). */
const SignupOwnerFields = ({ form, confirm, onChange, onConfirmChange, onSubmit }: SignupOwnerFieldsProps) => (
  <div className="signup__grid">
    <label className="signup__field">
      <span className="signup__label">First name</span>
      <input className="signup__input" autoComplete="given-name" value={form.firstName} onChange={(e) => onChange({ firstName: e.target.value })} />
    </label>

    <label className="signup__field">
      <span className="signup__label">Last name</span>
      <input className="signup__input" autoComplete="family-name" value={form.lastName} onChange={(e) => onChange({ lastName: e.target.value })} />
    </label>

    <label className="signup__field signup__field--wide">
      <span className="signup__label">Owner email</span>
      <input className="signup__input" type="email" autoComplete="email" value={form.email} onChange={(e) => onChange({ email: e.target.value })} />
    </label>

    <label className="signup__field">
      <span className="signup__label">Password</span>
      <input className="signup__input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => onChange({ password: e.target.value })} />
    </label>

    <label className="signup__field">
      <span className="signup__label">Repeat password</span>
      <input
        className="signup__input"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => onConfirmChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
      />
    </label>
  </div>
);

/** Lo que la empresa acepta al registrarse (las mismas reglas que aplica el app). */
const TRIAL_TERMS = [
  `${TRIAL_DAYS} days free, starting when your company is approved.`,
  `During the trial each form (purchase orders, sales, expenses, customers, catalogs…) allows up to ${TRIAL_RECORD_LIMIT} records.`,
  `If you don't subscribe when the trial ends, access is blocked for ${TRIAL_GRACE_DAYS} days so you can still subscribe and keep everything.`,
  `After that, all the data saved during the trial is permanently deleted and cannot be recovered.`,
];

interface SignupTrialTermsProps {
  accepted: boolean;
  onToggle: () => void;
}

/** Condiciones de la prueba gratuita, con la casilla que hay que marcar para registrarse. */
const SignupTrialTerms = ({ accepted, onToggle }: SignupTrialTermsProps) => (
  <section className="signup__terms">
    <p className="signup__terms-title">
      <span className="signup__badge">{TRIAL_DAYS}-day free trial</span> How the free trial works
    </p>
    <ul className="signup__terms-list">
      {TRIAL_TERMS.map((term) => (
        <li key={term}>{term}</li>
      ))}
    </ul>
    <label className="signup__accept">
      <input type="checkbox" checked={accepted} onChange={onToggle} />
      <span>I understand the free trial limits and that unpaid trial data is permanently deleted.</span>
    </label>
  </section>
);

interface SignupViewProps {
  /** "I already have an account": va al login. */
  onBack: () => void;
  /** Vuelve a la landing page. */
  onHome: () => void;
}

/**
 * Alta publica de una empresa, en dos pasos: datos de la empresa y cuenta del
 * dueno. Al terminar la sesion ya queda iniciada y entra directo a la empresa
 * nueva (vacia), que espera la aprobacion de la plataforma.
 */
export function SignupView({ onBack, onHome }: SignupViewProps) {
  const { chooseCompany } = useAuth();
  const [form, setForm] = useState<SignupData>(emptyForm);
  const [confirm, setConfirm] = useState('');
  const [step, setStep] = useState<SignupStep>('company');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const handleFieldChange = (part: Partial<SignupData>) => setForm((current) => ({ ...current, ...part }));

  const handleLogoPick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setError('The logo must be smaller than 400 KB.');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => handleFieldChange({ logo: String(reader.result ?? '') });
    reader.readAsDataURL(file);
  };

  /* Vista previa: el registro toma el color elegido mientras se llena. */
  const handleColorChange = (color: string) => {
    handleFieldChange({ brandColor: color });
    applyBrandTheme(color);
  };

  const handleBackToLogin = () => {
    /* Las paginas publicas usan los colores de la plataforma. */
    applyBrandTheme(undefined);
    onBack();
  };

  const handleNext = () => {
    if (!form.companyName.trim()) return setError('Enter the company legal name.');
    if (!form.address.trim()) return setError('Enter the company address.');
    setError(null);
    setStep('owner');
  };

  const handlePrevious = () => {
    setError(null);
    setStep('company');
  };

  const handleSubmit = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) return setError('Enter the owner first and last name.');
    if (!form.email.trim()) return setError('Enter the owner email.');
    if (form.password.length < MIN_PASSWORD_LENGTH) return setError('The password needs at least 6 characters.');
    if (form.password !== confirm) return setError('The passwords do not match.');
    if (!termsAccepted) return setError('Please confirm that you understand the free trial terms.');

    setError(null);
    setBusy(true);
    try {
      const { companyId } = await signUpCompany(form);
      /* La sesion ya quedo iniciada: entra directo a la empresa nueva. */
      clearPublicPage();
      chooseCompany(companyId);
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      setError(ERROR_MESSAGES[code] ?? 'The company could not be registered. Try again.');
      setBusy(false);
    }
  };

  const handleToggleTerms = () => setTermsAccepted((current) => !current);

  const isCompanyStep = step === 'company';

  return (
    <div className="signup">
      <button type="button" className="signup__brand" onClick={onHome} aria-label={`${PLATFORM_BRAND.name} home`}>
        <img className="signup__brand-logo" src={PLATFORM_BRAND.logoWhite} alt={PLATFORM_BRAND.name} />
      </button>
      <div className="signup__card">
        <p className="signup__step">{isCompanyStep ? 'Step 1 of 2 · Company' : 'Step 2 of 2 · Owner account'}</p>
        <h1 className="signup__title">Register your company</h1>
        <p className="signup__hint">
          {isCompanyStep
            ? 'Your company details. They appear in the app and on your documents.'
            : 'The owner account. You will sign in with this email and password.'}
        </p>
        {isCompanyStep && (
          <p className="signup__trial">
            <span className="signup__badge">{TRIAL_DAYS} days free</span> Up to {TRIAL_RECORD_LIMIT} records per form
            during the trial.
          </p>
        )}

        {isCompanyStep && (
          <SignupCompanyFields
            form={form}
            onChange={handleFieldChange}
            onLogoPick={handleLogoPick}
            onColorChange={handleColorChange}
          />
        )}
        {!isCompanyStep && (
          <SignupOwnerFields
            form={form}
            confirm={confirm}
            onChange={handleFieldChange}
            onConfirmChange={setConfirm}
            onSubmit={() => void handleSubmit()}
          />
        )}
        {!isCompanyStep && <SignupTrialTerms accepted={termsAccepted} onToggle={handleToggleTerms} />}

        {error && <div className="signup__message">{error}</div>}

        {isCompanyStep && (
          <>
            <button type="button" className="signup__submit" onClick={handleNext}>
              Next
            </button>
            <button type="button" className="signup__back" onClick={handleBackToLogin}>
              I already have an account
            </button>
          </>
        )}
        {!isCompanyStep && (
          <>
            <button type="button" className="signup__submit" disabled={busy} onClick={() => void handleSubmit()}>
              {busy ? 'Creating your company…' : 'Create company'}
            </button>
            <button type="button" className="signup__back" disabled={busy} onClick={handlePrevious}>
              Back
            </button>
          </>
        )}

        <p className="signup__note">
          You become the owner of the company and start with an empty workspace. New companies are
          reviewed before they can start working; once yours is approved, your {TRIAL_DAYS}-day free
          trial starts and you will see it here right away.
        </p>
      </div>
    </div>
  );
}
