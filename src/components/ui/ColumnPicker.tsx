import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { ColumnVisibility } from '../../hooks/useColumnVisibility';
import './ColumnPicker.css';

interface ColumnPickerProps {
  view: ColumnVisibility;
}

interface MenuPosition {
  top: number;
  right: number;
}

/* El menu es fijo a la pantalla: asi no lo recorta la barra de acciones cuando se desliza de lado. */
const menuStyle = (position: MenuPosition): CSSProperties =>
  ({
    '--column-picker-right': `${position.right}px`,
    '--column-picker-top': `${position.top}px`,
  }) as CSSProperties;

/**
 * Boton "Columns" de la barra de una tabla: abre la lista de columnas para mostrar
 * u ocultar cada una. La eleccion la guarda `useColumnVisibility`.
 */
export const ColumnPicker = ({ view }: ColumnPickerProps) => {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const open = position !== null;

  /* Cierra al hacer clic fuera del boton y del menu. */
  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setPosition(null);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  /* Cierra con Escape. */
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPosition(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  /* El menu es fijo: si la ventana cambia de tamano, se cierra para no quedar fuera de lugar. */
  useEffect(() => {
    if (!open) return undefined;
    const handleResize = () => setPosition(null);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [open]);

  const handleToggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    if (open) {
      setPosition(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ top: rect.bottom + 6, right: Math.max(window.innerWidth - rect.right, 8) });
  };

  const visibleCount = view.options.length - view.hiddenCount;
  const buttonLabel = view.hiddenCount > 0 ? `Columns (${visibleCount}/${view.options.length})` : 'Columns';

  return (
    <div className="column-picker" ref={wrapperRef}>
      <button
        type="button"
        className={`btn btn--secondary column-picker__button${view.hiddenCount > 0 ? ' column-picker__button--filtered' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={handleToggleMenu}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
        {buttonLabel}
      </button>

      {position && (
        <div className="column-picker__menu" role="menu" style={menuStyle(position)}>
          <p className="column-picker__title">Show columns</p>
          <ul className="column-picker__list">
            {view.options.map((option) => {
              const checked = view.isVisible(option.key);
              const lastVisible = checked && visibleCount === 1;
              return (
                <li key={option.key}>
                  <label className={`column-picker__option${lastVisible ? ' column-picker__option--locked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={lastVisible}
                      onChange={() => view.toggle(option.key)}
                    />
                    <span>{option.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <button type="button" className="column-picker__show-all" disabled={view.hiddenCount === 0} onClick={view.showAll}>
            Show all
          </button>
        </div>
      )}
    </div>
  );
};
