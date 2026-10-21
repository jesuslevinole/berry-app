import { useMemo, useSyncExternalStore } from 'react';
import { useActiveCompanyId } from './useActiveCompanyId';

/** Columna que el usuario puede mostrar u ocultar con el boton "Columns". */
export interface ColumnOption {
  key: string;
  label: string;
}

export interface ColumnVisibility {
  options: ColumnOption[];
  hiddenCount: number;
  isVisible: (key: string) => boolean;
  toggle: (key: string) => void;
  showAll: () => void;
}

/*
 * Las columnas ocultas se guardan en este navegador, por empresa y por tabla
 * (preferencia personal de vista, no configuracion de la empresa: esa es el Configurator).
 * Se guardan las OCULTAS, asi una columna nueva aparece visible.
 */
const STORAGE_PREFIX = 'berry-columns';
const listeners = new Set<() => void>();

const storageKeyOf = (companyId: string, tableId: string): string => `${STORAGE_PREFIX}:${companyId || 'none'}:${tableId}`;

const readRaw = (key: string): string => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

const writeHidden = (key: string, hidden: string[]): void => {
  try {
    if (hidden.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(hidden));
  } catch {
    /* Sin localStorage: la eleccion dura hasta recargar la pagina. */
  }
  listeners.forEach((notify) => notify());
};

const parseHidden = (raw: string): string[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
};

/* Avisa a todas las tablas abiertas (y a otras pestanas) cuando cambia una eleccion. */
const subscribe = (notify: () => void): (() => void) => {
  listeners.add(notify);
  window.addEventListener('storage', notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener('storage', notify);
  };
};

/** Opciones a partir de las columnas de un DataTable (key + header). */
export const columnOptionsOf = (columns: Array<{ key: string; header: string; pickerLabel?: string }>): ColumnOption[] =>
  columns.map((col) => ({ key: col.key, label: col.header || col.pickerLabel || col.key }));

/**
 * Columnas visibles de una tabla, elegidas por el usuario con `ColumnPicker`.
 * `tableId` identifica la tabla (unico en el app); siempre queda al menos una columna visible.
 */
export function useColumnVisibility(tableId: string, options: ColumnOption[]): ColumnVisibility {
  const companyId = useActiveCompanyId();
  const storageKey = storageKeyOf(companyId, tableId);
  const raw = useSyncExternalStore(subscribe, () => readRaw(storageKey));
  const hidden = useMemo(() => new Set(parseHidden(raw)), [raw]);

  const hiddenCount = options.filter((opt) => hidden.has(opt.key)).length;

  const isVisible = (key: string): boolean => !hidden.has(key);

  const toggle = (key: string): void => {
    const next = new Set(hidden);
    if (next.has(key)) {
      next.delete(key);
    } else {
      const stillVisible = options.filter((opt) => opt.key !== key && !next.has(opt.key)).length;
      if (stillVisible === 0) return;
      next.add(key);
    }
    writeHidden(storageKey, [...next]);
  };

  const showAll = (): void => writeHidden(storageKey, []);

  return { options, hiddenCount, isVisible, toggle, showAll };
}

/** Atajo para un DataTable: devuelve la vista para `ColumnPicker` y solo las columnas visibles. */
export function useDataTableColumns<C extends { key: string; header: string; pickerLabel?: string }>(
  tableId: string,
  columns: C[],
): { view: ColumnVisibility; visibleColumns: C[] } {
  const view = useColumnVisibility(tableId, columnOptionsOf(columns));
  return { view, visibleColumns: columns.filter((col) => view.isVisible(col.key)) };
}
