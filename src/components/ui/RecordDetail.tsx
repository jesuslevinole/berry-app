import type { ReactNode } from 'react';
import './RecordDetail.css';

export interface DetailField {
  label: string;
  value: ReactNode;
}

/** Seccion titulada para la zona derecha (lineas, pagos, resumen financiero). */
export function DetailSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="record-detail__section">
      <div className="record-detail__section-head">
        <h4 className="record-detail__section-title">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

interface RecordDetailProps {
  title: string;
  badge?: ReactNode;
  onClose: () => void;
  /** Si se pasa, muestra el boton Edit (gatear con can(modulo,'edit')). */
  onEdit?: () => void;
  /** Campos del formulario principal (columna izquierda, en el orden configurado). */
  fields: DetailField[];
  /** Secciones del detalle (columna derecha): lineas, pagos, resumen. */
  children?: ReactNode;
}

/**
 * Vista de detalle de solo lectura: los campos del registro principal a la
 * izquierda y las secciones de detalle claramente separadas a la derecha.
 */
export function RecordDetail({ title, badge, onClose, onEdit, fields, children }: RecordDetailProps) {
  return (
    <div className="record-detail__overlay" onClick={onClose}>
      <div className="record-detail" onClick={(e) => e.stopPropagation()}>
        <header className="record-detail__header">
          <div className="record-detail__heading">
            <h3 className="record-detail__title">{title}</h3>
            {badge}
          </div>
          <div className="record-detail__actions">
            {onEdit && (
              <button type="button" className="btn btn--primary" onClick={onEdit}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M17 3l4 4L8 20H4v-4L17 3z" />
                </svg>
                Edit
              </button>
            )}
            <button type="button" className="record-detail__close" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>

        <div className="record-detail__body">
          <aside className="record-detail__fields">
            <h4 className="record-detail__fields-title">Record information</h4>
            {fields.map((field) => (
              <div className="record-detail__field" key={field.label}>
                <span className="record-detail__field-label">{field.label}</span>
                <span className="record-detail__field-value">
                  {field.value === '' || field.value === null || field.value === undefined ? '—' : field.value}
                </span>
              </div>
            ))}
          </aside>

          <div className="record-detail__content">{children}</div>
        </div>
      </div>
    </div>
  );
}
