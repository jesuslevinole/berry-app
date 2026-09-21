import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CatalogOption } from '../../hooks/useCatalog';
import './SearchableSelect.css';

interface SearchableSelectProps {
  value: string;
  onChange: (id: string) => void;
  options: CatalogOption[];
  placeholder?: string;
  /** Titulo del modal de seleccion (por defecto se deriva del placeholder). */
  title?: string;
}

/** "Select commodity…" -> "Select commodity" para usarlo como titulo. */
const titleFrom = (placeholder: string): string => placeholder.replace(/[.…]+$/u, '').trim() || 'Select an option';

/**
 * Selector de catalogo: el campo se ve como un input y, al hacer clic, abre un
 * modal centrado con buscador y la lista completa. Al elegir una opcion se
 * coloca en el campo y el modal se cierra. Teclado: flechas, Enter y Escape.
 * Se renderiza en un portal para no quedar recortado dentro de otros modales.
 */
export function SearchableSelect({ value, onChange, options, placeholder = 'Select…', title }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => o.name.toLowerCase().includes(t));
  }, [options, term]);

  const openPicker = () => {
    setTerm('');
    /* Arranca resaltando la opcion ya elegida, si existe. */
    setHighlight(Math.max(options.findIndex((o) => o.id === value), 0));
    setOpen(true);
  };

  const close = () => setOpen(false);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  /* Foco en el buscador al abrir y bloqueo del scroll de fondo. */
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    document.body.classList.add('ssel-lock');
    return () => {
      document.body.classList.remove('ssel-lock');
    };
  }, [open]);

  /* Mantener visible la opcion resaltada al navegar con el teclado. */
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector('.ssel-modal__option--highlight');
    node?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
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

  const heading = title ?? titleFrom(placeholder);

  return (
    <div className="ssel">
      <button
        type="button"
        className={`input ssel__control${selected ? '' : ' ssel__control--empty'}`}
        onClick={openPicker}
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

      {open &&
        createPortal(
          <div
            className="ssel-modal__overlay"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div className="ssel-modal" role="dialog" aria-modal="true" aria-label={heading} onKeyDown={handleKeyDown}>
              <header className="ssel-modal__header">
                <h3 className="ssel-modal__title">{heading}</h3>
                <button type="button" className="ssel-modal__close" onClick={close} aria-label="Close">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </header>

              <div className="ssel-modal__search-wrap">
                <svg className="ssel-modal__search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <input
                  ref={inputRef}
                  className="ssel-modal__search"
                  placeholder="Type to search…"
                  value={term}
                  onChange={(e) => {
                    setTerm(e.target.value);
                    setHighlight(0);
                  }}
                />
                <span className="ssel-modal__count">
                  {filtered.length} of {options.length}
                </span>
              </div>

              <div className="ssel-modal__list" ref={listRef}>
                {filtered.length === 0 && <div className="ssel-modal__empty">No matches for “{term}”.</div>}
                {filtered.map((option, index) => (
                  <button
                    type="button"
                    key={option.id}
                    className={
                      'ssel-modal__option' +
                      (option.id === value ? ' ssel-modal__option--selected' : '') +
                      (index === highlight ? ' ssel-modal__option--highlight' : '')
                    }
                    onClick={() => pick(option.id)}
                  >
                    <span className="ssel-modal__option-name">{option.name}</span>
                    {option.id === value && (
                      <svg className="ssel-modal__check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4">
                        <path d="M5 12l5 5L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>

              <footer className="ssel-modal__footer">
                <span className="ssel-modal__hint">↑ ↓ to move · Enter to select · Esc to close</span>
                {selected && (
                  <button type="button" className="ssel-modal__clear-btn" onClick={() => pick('')}>
                    Clear selection
                  </button>
                )}
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
