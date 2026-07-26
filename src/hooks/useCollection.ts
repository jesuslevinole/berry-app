import { useEffect, useState } from 'react';
import type { QueryConstraint } from 'firebase/firestore';
import { subscribeToCollection } from '../services/firestore';
import type { BaseDoc } from '../types/models';

interface UseCollectionResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
}

/**
 * Suscripcion en tiempo real a una coleccion.
 * `depsKey` re-suscribe cuando cambian los constraints (p. ej. el id del padre).
 */
export function useCollection<T extends BaseDoc>(
  colName: string,
  constraints?: QueryConstraint[],
  depsKey = '',
): UseCollectionResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const unsubscribe = subscribeToCollection<T>(
      colName,
      (rows) => {
        setData(rows);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
      constraints ?? [],
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colName, depsKey]);

  return { data, loading, error };
}
