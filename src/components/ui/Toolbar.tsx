import type { ReactNode } from 'react';
import './Toolbar.css';

interface ToolbarProps {
  title: string;
  subtitle?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  children?: ReactNode;
}

/** Encabezado de vista: titulo + buscador + acciones, todo en una sola fila. */
export function Toolbar({ title, subtitle, searchValue, onSearchChange, children }: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar__heading">
        <h2 className="toolbar__title">{title}</h2>
        {subtitle && <span className="toolbar__subtitle">{subtitle}</span>}
      </div>
      <div className="toolbar__actions">
        {onSearchChange && (
          <input
            className="input toolbar__search"
            type="search"
            placeholder="Search…"
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        )}
        {children}
      </div>
    </div>
  );
}
