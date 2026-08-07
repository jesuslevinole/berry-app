import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { createDocumentLocalFirst } from '../../services/firestore';
import type { CatalogOption } from '../../hooks/useCatalog';
import { SearchableSelect } from './SearchableSelect';
import './CatalogSelect.css';

interface CatalogSelectProps {
  value: string;
  onChange: (id: string) => void;
  options: CatalogOption[];
  /** Coleccion destino del alta rapida (ej. COLLECTIONS.GROWER). */
  collection: string;
  /** Campo de nombre de la coleccion (ej. 'NAME_GROWER'). */
  nameField: string;
  /** Etiqueta singular para el mini-modal (ej. 'grower'). */
  catalogLabel: string;
}

/**
 * Select de catalogo con boton "+" de alta rapida: crea el registro sin salir
 * del formulario y lo deja seleccionado. La opcion nueva aparece en todos los
 * selects abiertos via la suscripcion en tiempo real del catalogo.
 */
export function CatalogSelect({
  value,
  onChange,
  options,
  collection,
  nameField,
  catalogLabel,
}: CatalogSelectProps) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newId = createDocumentLocalFirst(
      collection,
      { [nameField]: trimmed },
      (error) => alert(`Failed to create ${catalogLabel}: ${error.message}`),
    );
    onChange(newId);
    setName('');
    setOpen(false);
  };

  return (
    <div className="catsel">
      <div className="catsel__select">
        <SearchableSelect value={value} onChange={onChange} options={options} />
      </div>

      {can('catalogs', 'add') && (
        <button
          type="button"
          className="catsel__add"
          title={`New ${catalogLabel}`}
          aria-label={`New ${catalogLabel}`}
          onClick={() => {
            setName('');
            setOpen(true);
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}

      {open && (
        <div className="catsel__overlay" onClick={() => setOpen(false)}>
          <div className="catsel__modal" onClick={(e) => e.stopPropagation()}>
            <h4 className="catsel__title">New {catalogLabel}</h4>
            <input
              className="input catsel__input"
              autoFocus
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setOpen(false);
              }}
            />
            <p className="catsel__hint">
              It is created and selected instantly. You can complete its details later in Catalogs.
            </p>
            <div className="catsel__actions">
              <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="btn btn--primary" disabled={!name.trim()} onClick={handleCreate}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
