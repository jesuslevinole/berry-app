import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { useAppConfig } from '../../context/AppConfigContext';
import './FormField.css';

interface FormFieldProps {
  label: string;
  children: ReactNode;
  span2?: boolean;
  required?: boolean;
}

export function FormField({ label, children, span2 = false, required = false }: FormFieldProps) {
  return (
    <label className={`form-field${span2 ? ' form-field--span2' : ''}`}>
      <span className="form-field__label">
        {label}
        {required && <span className="form-field__required" title="Required">*</span>}
      </span>
      {children}
    </label>
  );
}

/** Grid responsive compartido por todos los formularios. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="form-grid">{children}</div>;
}

/**
 * Grid configurable: reordena, renombra y marca como obligatorios los
 * FormField hijos segun la configuracion guardada del formulario (formId).
 * La clave estable de cada campo es su etiqueta por defecto en el codigo.
 */
export function ConfigurableGrid({ formId, children }: { formId: string; children: ReactNode }) {
  const { fieldsFor } = useAppConfig();
  const elements = Children.toArray(children).filter(isValidElement) as ReactElement<FormFieldProps>[];
  const defaults = elements.map((el) => el.props.label);
  const config = fieldsFor(formId, defaults);
  const byKey = new Map(elements.map((el) => [el.props.label, el]));
  return (
    <div className="form-grid">
      {config.map((field) => {
        const el = byKey.get(field.key);
        return el
          ? cloneElement(el, { key: field.key, label: field.label, required: field.required })
          : null;
      })}
    </div>
  );
}
