import { useCollection } from './useCollection';
import { useActiveCompanyId } from './useActiveCompanyId';
import { where } from '../services/firestore';
import { COLLECTIONS, type SystemUser } from '../types/models';

/**
 * Usuarios (membresias) de la empresa ACTIVA. system_users es global: sin el filtro
 * por companyId el admin de plataforma veia los usuarios de todas las empresas y
 * a los demas Firestore les negaba la consulta.
 */
export const useCompanyUsers = () => {
  const companyId = useActiveCompanyId();
  return useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS, [where('companyId', '==', companyId)], `company-users:${companyId}`);
};
