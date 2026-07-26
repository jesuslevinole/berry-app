import { useMemo } from 'react';
import { useCollection } from './useCollection';
import type { BaseDoc } from '../types/models';

export interface CatalogOption {
  id: string;
  name: string;
}

type CatalogDoc = BaseDoc & Record<string, unknown>;

/**
 * Catalogo listo para selects: opciones ordenadas + resolutor id -> nombre.
 * Reutilizado por todos los formularios y tablas que muestran FKs.
 */
export function useCatalog(colName: string, nameField: string) {
  const { data, loading } = useCollection<CatalogDoc>(colName);

  const options = useMemo<CatalogOption[]>(
    () =>
      data
        .map((d) => ({ id: d.id, name: String(d[nameField] ?? '') }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data, nameField],
  );

  const nameOf = useMemo(() => {
    const map = new Map(options.map((o) => [o.id, o.name]));
    return (id?: string): string => (id ? (map.get(id) ?? '—') : '—');
  }, [options]);

  return { options, nameOf, loading };
}
