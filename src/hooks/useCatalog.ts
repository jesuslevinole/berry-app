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

  /* Resolucion tolerante: acepta el ID del documento o el propio nombre guardado
     (datos importados desde AppSheet donde la columna trae el nombre, no el ID). */
  const lookup = useMemo(() => {
    const byId = new Map(options.map((o) => [o.id, o.name]));
    const byName = new Map(options.filter((o) => o.name).map((o) => [o.name.trim().toLowerCase(), o.name]));
    return (value?: string): string | null => {
      if (!value) return null;
      return byId.get(value) ?? byName.get(value.trim().toLowerCase()) ?? null;
    };
  }, [options]);

  const nameOf = useMemo(() => (id?: string): string => lookup(id) ?? '—', [lookup]);

  /** Como nameOf, pero muestra el valor crudo si no esta en el catalogo (nunca "—" a secas). */
  const labelOf = useMemo(
    () => (id?: string): string => lookup(id) ?? (id ? id : '—'),
    [lookup],
  );

  return { options, nameOf, labelOf, loading };
}
