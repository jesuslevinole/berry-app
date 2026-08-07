import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogOption } from '../../hooks/useCatalog';
import './SearchableSelect.css';

interface SearchableSelectProps {
  value: string;
  onChange: (id: string) => void;
  options: CatalogOption[];
  placeholder?: string;
}

/**
 * Dropdown con busqueda: al abrir muestra un input que filtra las opciones.
 * Soporta teclado (flechas + Enter + Escape), boton de limpiar y cierre al
 * hacer clic fuera. Reemplaza a los <select> nativos en toda la app.
 */
export function SearchableSelect({ value, onChange, options, placeholder = 'Select…' }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => o.name.toLowerCase().includes(t));
  }, [options, term]);

  /* Cerrar al hacer clic fuera */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  /* Enfocar el buscador al abrir */
  useEffect(() => {
    if (open) {
      setTerm('');
      setHighlight(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const option = filtered[highlight];
      if (option) pick(option.id);
    }
  };

  return (
    <div className="ssel" ref={rootRef}>
      <button
        type="button"
        className={`input ssel__control${selected ? '' : ' ssel__control--empty'}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ssel__value">{selected ? selected.name : placeholder}</span>
        <span className="ssel__icons">
          {selected && (
            <span
              className="ssel__clear"
              role="button"
              aria-label="Clear"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </span>
          )}
          <svg className="ssel__chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="ssel__popup">
          <input
            ref={inputRef}
            className="ssel__search"
            placeholder="Type to search…"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="ssel__list">
            {filtered.length === 0 && <div className="ssel__no-results">No matches</div>}
            {filtered.map((option, index) => (
              <button
                type="button"
                key={option.id}
                className={
                  'ssel__option' +
                  (option.id === value ? ' ssel__option--selected' : '') +
                  (index === highlight ? ' ssel__option--highlight' : '')
                }
                onClick={() => pick(option.id)}
              >
                {option.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
