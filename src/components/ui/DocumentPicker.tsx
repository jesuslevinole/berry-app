import './DocumentPicker.css';

export interface DocumentOption {
  id: string;
  label: string;
  description: string;
}

interface DocumentPickerProps {
  title: string;
  subtitle?: string;
  options: DocumentOption[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** Modal para elegir que documento generar (Sales Desk y Purchase Orders). */
export function DocumentPicker({ title, subtitle, options, onSelect, onClose }: DocumentPickerProps) {
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
            <button
              key={option.id}
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
          ))}
        </div>
      </div>
    </div>
  );
}
