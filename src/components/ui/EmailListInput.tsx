import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { isValidEmail, parseEmails } from '../../services/emailService';
import './EmailListInput.css';

interface Props {
  /** Correos guardados como texto separado por comas ("a@x.com, b@y.com"). */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/** Lista -> texto guardado (mismo formato que la EnumList de AppSheet). */
const joinEmails = (emails: string[]): string => emails.join(', ');

/**
 * Lista de correos (EnumList): cada correo es una etiqueta que se quita con la X.
 * Se agrega con Enter, coma, espacio o al salir del campo; pegar varios los separa solos.
 */
export function EmailListInput({ value, onChange, placeholder = 'Add an email and press Enter', disabled = false }: Props) {
  const emails = parseEmails(value);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const add = (raw: string): boolean => {
    const incoming = parseEmails(raw);
    if (incoming.length === 0) return true;
    const bad = incoming.filter((e) => !isValidEmail(e));
    if (bad.length) {
      setError(`Not a valid email: ${bad.join(', ')}`);
      return false;
    }
    const next = [...emails];
    for (const e of incoming) {
      if (!next.some((x) => x.toLowerCase() === e.toLowerCase())) next.push(e.toLowerCase());
    }
    onChange(joinEmails(next));
    setError('');
    return true;
  };

  const commit = () => {
    if (add(text)) setText('');
  };

  const remove = (email: string) => onChange(joinEmails(emails.filter((e) => e !== email)));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ' || e.key === 'Tab') {
      if (!text.trim()) return;
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !text && emails.length) {
      remove(emails[emails.length - 1]);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (!/[,;\s]/.test(pasted.trim())) return;
    e.preventDefault();
    if (add(`${text} ${pasted}`)) setText('');
  };

  return (
    <div className="email-list">
      <div className={`email-list__box${disabled ? ' email-list__box--disabled' : ''}${error ? ' email-list__box--error' : ''}`}>
        {emails.map((email) => (
          <span key={email} className="email-list__chip">
            {email}
            {!disabled && (
              <button type="button" className="email-list__remove" aria-label={`Remove ${email}`} onClick={() => remove(email)}>
                ×
              </button>
            )}
          </span>
        ))}
        <input
          className="email-list__input"
          type="email"
          value={text}
          disabled={disabled}
          placeholder={emails.length ? '' : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={commit}
        />
      </div>
      {error && <span className="email-list__error">{error}</span>}
    </div>
  );
}
