/**
 * Multi-empresa (SaaS): cada compania guarda sus datos en su propio subarbol
 * de Firestore -> companies/{companyId}/<COLECCION>.
 *
 * Ninguna consulta puede ver datos de otra compania porque la ruta misma es
 * distinta; no depende de acordarse de filtrar por un campo en cada query.
 */

/** Colecciones globales de la plataforma (viven en la raiz, fuera de toda empresa). */
export const GLOBAL_COLLECTIONS = new Set<string>(['companies', 'system_users']);

/** Ruta imposible: si no hay empresa activa, las consultas devuelven vacio en vez de leer la raiz. */
const NO_COMPANY_PATH = 'companies/__none__';

let activeCompanyId = '';

/** Empresa activa de la sesion (vacio mientras se resuelve el perfil del usuario). */
export function getActiveCompanyId(): string {
  return activeCompanyId;
}

/** Define la empresa activa. La llama AuthContext al resolver el perfil del usuario. */
export function setActiveCompanyId(companyId: string): void {
  activeCompanyId = companyId ?? '';
}

/**
 * Traduce el nombre logico de una coleccion a su ruta real segun la empresa activa.
 * Las colecciones globales se devuelven tal cual.
 */
export function tenantPath(colName: string): string {
  if (GLOBAL_COLLECTIONS.has(colName)) return colName;
  if (!activeCompanyId) return `${NO_COMPANY_PATH}/${colName}`;
  return `companies/${activeCompanyId}/${colName}`;
}

/** Ruta de una coleccion dentro de una empresa concreta (migraciones, admin de plataforma). */
export function pathForCompany(companyId: string, colName: string): string {
  if (GLOBAL_COLLECTIONS.has(colName)) return colName;
  return `companies/${companyId}/${colName}`;
}
