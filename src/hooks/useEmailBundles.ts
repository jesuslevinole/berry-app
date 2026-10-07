import { useMemo } from 'react';
import { useCollection } from './useCollection';
import { emailTargets } from '../config/emailDocs';
import { COLLECTIONS, type EmailBundle } from '../types/models';

/** Envios combinados guardados en Email Settings (ej. "Pick Tix and BOL"), por nombre. */
export function useEmailBundles() {
  const { data, loading } = useCollection<EmailBundle>(COLLECTIONS.EMAIL_BUNDLES);
  const bundles = useMemo(
    () => [...data].filter((b) => (b.DOCS ?? []).length > 0).sort((a, b) => (a.NAME ?? '').localeCompare(b.NAME ?? '')),
    [data],
  );
  /** Documentos + combinados: columnas de Recipients y lista de Messages. */
  const targets = useMemo(() => emailTargets(bundles), [bundles]);
  return { bundles, targets, loading };
}
