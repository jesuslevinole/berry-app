import type { ReactNode } from 'react';
import './FormField.css';

interface FormFieldProps {
  label: string;
  children: ReactNode;
  span2?: boolean;
}

export function FormField({ label, children, span2 = false }: FormFieldProps) {
  return (
    <label className={`form-field${span2 ? ' form-field--span2' : ''}`}>
      <span className="form-field__label">{label}</span>
      {children}
    </label>
  );
}

/** Grid responsive compartido por todos los formularios. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="form-grid">{children}</div>;
}
