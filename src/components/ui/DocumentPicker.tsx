import './DocumentPicker.css';

export interface DocumentOption {
  id: string;
  label: string;
  description: string;
  /** false = este documento no se envia por correo (sin boton de sobre). */
  emailable?: boolean;
}

interface DocumentPickerProps {
  title: string;
  subtitle?: string;
  options: DocumentOption[];
  onSelect: (id: string) => void;
  /** Si se pasa, cada documento muestra un boton para enviarlo por correo. */
  onEmail?: (id: string) => void;
  /** Envios combinados (varios documentos en un mismo correo). */
  bundles?: DocumentOption[];
  onEmailBundle?: (id: string) => void;
  onClose: () => void;
}

/** Modal para elegir que documento generar (Sales Desk y Purchase Orders). */
export function DocumentPicker({ title, subtitle, options, onSelect, onEmail, bundles = [], onEmailBundle, onClose }: DocumentPickerProps) {
  return (
    <div className="doc-picker__overlay" onClick={onClose}>
      <div className="doc-picker" onClick={(e) => e.stopPropagation()}>
        <header className="doc-picker__header">
          <div>
            <h3 className="doc-picker__title">{title}</h3>
            {subtitle && <p className="doc-picker__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="doc-picker__close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="doc-picker__list">
          {options.map((option) => (
            <div key={option.id} className="doc-picker__row">
            <button
              type="button"
              className="doc-picker__option"
              onClick={() => onSelect(option.id)}
            >
              <span className="doc-picker__icon">
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" /><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" />
                </svg>
              </span>
              <span className="doc-picker__texts">
                <span className="doc-picker__label">{option.label}</span>
                <span className="doc-picker__description">{option.description}</span>
              </span>
              <span className="doc-picker__chevron">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </span>
            </button>
            {onEmail && option.emailable !== false && (
              <button
                type="button"
                className="doc-picker__email"
                onClick={() => onEmail(option.id)}
                aria-label={`Email ${option.label}`}
                title={`Email ${option.label}`}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5l8.5 6 8.5-6" />
                </svg>
              </button>
            )}
            </div>
          ))}
        </div>

        {onEmailBundle && bundles.length > 0 && (
          <div className="doc-picker__bundles">
            <p className="doc-picker__section">Send together</p>
            {bundles.map((bundle) => (
              <button
                key={bundle.id}
                type="button"
                className="doc-picker__option doc-picker__option--bundle"
                onClick={() => onEmailBundle(bundle.id)}
                title={`Email ${bundle.label}`}
              >
                <span className="doc-picker__icon doc-picker__icon--bundle">
                  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5l8.5 6 8.5-6" />
                  </svg>
                </span>
                <span className="doc-picker__texts">
                  <span className="doc-picker__label">{bundle.label}</span>
                  <span className="doc-picker__description">{bundle.description}</span>
                </span>
                <span className="doc-picker__chevron">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
