import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { useActiveCompanyId } from './useActiveCompanyId';

/** Columna que el usuario puede mostrar, ocultar o mover con el boton "Columns". */
export interface ColumnOption {
  key: string;
  label: string;
}

/**
 * Columna de una tabla HTML propia (no DataTable): su encabezado y su celda, para pintarlas
 * con `view.arrange(columns)` en el orden y con la visibilidad que eligio el usuario.
 */
export interface OrderedColumn<T> {
  key: string;
  th: ReactNode;
  td: (row: T) => ReactNode;
}

export interface ColumnVisibility {
  /** Columnas en el orden del usuario (o el de siempre si su rol no puede reordenar). */
  options: ColumnOption[];
  hiddenCount: number;
  isVisible: (key: string) => boolean;
  toggle: (key: string) => void;
  showAll: () => void;
  /** El rol del usuario tiene "Reorder table columns" (Roles → Configurator capabilities). */
  canReorder: boolean;
  /** true si el usuario cambio el orden de esta tabla. */
  reordered: boolean;
  /** Mueve la columna `key` a la posicion `toIndex` de la lista. */
  move: (key: string, toIndex: number) => void;
  resetOrder: () => void;
  /** Deja solo las columnas visibles, en el orden del usuario. */
  arrange: <C extends { key: string }>(columns: C[]) => C[];
}

interface StoredView {
  hidden: string[];
  order: string[];
}

/*
 * La vista de cada tabla (columnas ocultas y orden) se guarda en este navegador, por empresa
 * y por tabla: es preferencia personal, no configuracion de la empresa (esa es el Configurator).
 * Se guardan las OCULTAS, asi una columna nueva aparece visible; una columna que no esta en el
 * orden guardado se queda en su lugar de siempre.
 */
const STORAGE_PREFIX = 'berry-columns';
const listeners = new Set<() => void>();
const EMPTY_VIEW: StoredView = { hidden: [], order: [] };

const storageKeyOf = (companyId: string, tableId: string): string => `${STORAGE_PREFIX}:${companyId || 'none'}:${tableId}`;

const readRaw = (key: string): string => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

const writeView = (key: string, view: StoredView): void => {
  try {
    if (view.hidden.length === 0 && view.order.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(view));
  } catch {
    /* Sin localStorage: la eleccion dura hasta recargar la pagina. */
  }
  listeners.forEach((notify) => notify());
};

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : [];

/* Formato viejo (10/2026): solo la lista de ocultas. */
const parseView = (raw: string): StoredView => {
  if (!raw) return EMPTY_VIEW;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return { hidden: stringsOf(parsed), order: [] };
    if (parsed && typeof parsed === 'object') {
      const { hidden, order } = parsed as Record<string, unknown>;
      return { hidden: stringsOf(hidden), order: stringsOf(order) };
    }
  } catch {
    /* Valor danado: se usa la vista de siempre. */
  }
  return EMPTY_VIEW;
};

/**
 * Aplica el orden guardado sin mover las columnas que no estan en el: las guardadas ocupan
 * sus mismos lugares de siempre, pero en el orden del usuario.
 */
const applyOrder = (keys: string[], order: string[]): string[] => {
  const rank = new Map(order.map((key, index) => [key, index]));
  const ranked = keys.filter((key) => rank.has(key)).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  let next = 0;
  return keys.map((key) => (rank.has(key) ? ranked[next++] : key));
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
 * Columnas visibles de una tabla y su orden, elegidos por el usuario con `ColumnPicker`.
 * `tableId` identifica la tabla (unico en el app); siempre queda al menos una columna visible.
 * El orden solo se aplica si el rol tiene "Reorder table columns".
 */
export function useColumnVisibility(tableId: string, options: ColumnOption[]): ColumnVisibility {
  const companyId = useActiveCompanyId();
  const { canAdmin } = useAuth();
  const canReorder = canAdmin('columnOrder');
  const storageKey = storageKeyOf(companyId, tableId);
  const raw = useSyncExternalStore(subscribe, () => readRaw(storageKey));
  const stored = useMemo(() => parseView(raw), [raw]);
  const hidden = useMemo(() => new Set(stored.hidden), [stored]);

  const defaultKeys = options.map((opt) => opt.key);
  const orderedKeys = canReorder ? applyOrder(defaultKeys, stored.order) : defaultKeys;
  const position = new Map(orderedKeys.map((key, index) => [key, index]));
  const orderedOptions = orderedKeys
    .map((key) => options.find((opt) => opt.key === key))
    .filter((opt): opt is ColumnOption => !!opt);

  const hiddenCount = options.filter((opt) => hidden.has(opt.key)).length;
  const reordered = canReorder && orderedKeys.some((key, index) => key !== defaultKeys[index]);

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
    writeView(storageKey, { ...stored, hidden: [...next] });
  };

  const showAll = (): void => writeView(storageKey, { ...stored, hidden: [] });

  const move = (key: string, toIndex: number): void => {
    if (!canReorder) return;
    const from = orderedKeys.indexOf(key);
    const to = Math.max(0, Math.min(toIndex, orderedKeys.length - 1));
    if (from < 0 || from === to) return;
    const next = [...orderedKeys];
    next.splice(from, 1);
    next.splice(to, 0, key);
    writeView(storageKey, { ...stored, order: next });
  };

  const resetOrder = (): void => writeView(storageKey, { ...stored, order: [] });

  /* Las columnas que no son ocultables (acciones, casillas) no estan en `options`: se quedan al final. */
  const arrange = <C extends { key: string }>(columns: C[]): C[] =>
    columns
      .filter((col) => isVisible(col.key))
      .map((col, index) => ({ col, index }))
      .sort((a, b) => (position.get(a.col.key) ?? options.length + a.index) - (position.get(b.col.key) ?? options.length + b.index))
      .map(({ col }) => col);

  return {
    options: orderedOptions,
    hiddenCount,
    isVisible,
    toggle,
    showAll,
    canReorder,
    reordered,
    move,
    resetOrder,
    arrange,
  };
}

/** Atajo para un DataTable: devuelve la vista para `ColumnPicker` y las columnas visibles en el orden del usuario. */
export function useDataTableColumns<C extends { key: string; header: string; pickerLabel?: string }>(
  tableId: string,
  columns: C[],
): { view: ColumnVisibility; visibleColumns: C[] } {
  const view = useColumnVisibility(tableId, columnOptionsOf(columns));
  return { view, visibleColumns: view.arrange(columns) };
}
