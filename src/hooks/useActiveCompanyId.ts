import { useSyncExternalStore } from 'react';
import { getActiveCompanyId, onCompanyChange } from '../services/tenant';

const subscribe = (notify: () => void): (() => void) => {
  const off = onCompanyChange(notify);
  return () => {
    off();
  };
};

/**
 * Empresa activa como estado de React: las suscripciones directas a Firestore
 * (configuracion, ficha de la empresa) se rehacen cuando se resuelve o cambia.
 */
export function useActiveCompanyId(): string {
  return useSyncExternalStore(subscribe, getActiveCompanyId, getActiveCompanyId);
}
