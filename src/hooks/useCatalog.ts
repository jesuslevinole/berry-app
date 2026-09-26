import { useMemo } from 'react';
import { useCollection } from './useCollection';
import type { BaseDoc } from '../types/models';

export interface CatalogOption {
  id: string;
  name: string;
}

type CatalogDoc = BaseDoc & Record<string, unknown>;

const normKey = (value: string): string => value.trim().toLowerCase();

/** Campo de llave AppSheet de un catalogo: NAME_COMMODITIES -> ID_COMMODITIES. */
export const idFieldFor = (nameField: string): string | null =>
  nameField.startsWith('NAME_') ? `ID_${nameField.slice('NAME_'.length)}` : null;

/**
 * Todas las llaves con las que una linea puede referirse a un registro del
 * catalogo: el ID del documento en Firestore y el ID original de AppSheet
 * guardado en el propio registro (p. ej. ID_COMMODITIES).
 */
export function catalogKeysOf(doc: CatalogDoc, idField: string | null): string[] {
  const keys = [doc.id];
  const legacy = idField ? doc[idField] : undefined;
  if (typeof legacy === 'string' && legacy.trim()) keys.push(legacy);
  return keys.map(normKey);
}

/**
 * Catalogo listo para selects: opciones ordenadas + resolutor id -> nombre.
 * Reutilizado por todos los formularios y tablas que muestran FKs.
 */
export function useCatalog(colName: string, nameField: string, idField: string | null = idFieldFor(nameField)) {
  const { data, loading } = useCollection<CatalogDoc>(colName);

  const options = useMemo<CatalogOption[]>(
    () =>
      data
        .map((d) => ({ id: d.id, name: String(d[nameField] ?? '') }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data, nameField],
  );

  /* Resolucion tolerante (sin importar mayusculas/espacios): acepta el ID del
     documento, el ID de AppSheet guardado en el registro o el propio nombre
     (datos importados donde la columna trae el nombre, no el ID).
     Devuelve el ID canonico del documento. */
  const resolveId = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const d of data) {
      const name = String(d[nameField] ?? '');
      if (name.trim() && !byKey.has(normKey(name))) byKey.set(normKey(name), d.id);
    }
    /* Los IDs pesan mas que los nombres: se escriben despues para ganar. */
    for (const d of data) for (const key of catalogKeysOf(d, idField)) byKey.set(key, d.id);
    return (value?: string): string | null => (value ? (byKey.get(normKey(value)) ?? null) : null);
  }, [data, nameField, idField]);

  const lookup = useMemo(() => {
    const nameById = new Map(options.map((o) => [o.id, o.name]));
    return (value?: string): string | null => {
      const id = resolveId(value);
      return id ? (nameById.get(id) ?? null) : null;
    };
  }, [options, resolveId]);

  const nameOf = useMemo(() => (id?: string): string => lookup(id) ?? '—', [lookup]);

  /** Como nameOf, pero muestra el valor crudo si no esta en el catalogo (nunca "—" a secas). */
  const labelOf = useMemo(
    () => (id?: string): string => lookup(id) ?? (id ? id : '—'),
    [lookup],
  );

  /** ID canonico del documento; si no esta en el catalogo devuelve el valor tal cual. */
  const canonicalId = useMemo(() => (value?: string): string => resolveId(value) ?? value ?? '', [resolveId]);

  return { options, nameOf, labelOf, canonicalId, loading };
}
