/**
 * Borrado definitivo de una empresa: todo su subarbol companies/{id}/..., sus
 * membresias en system_users y su ficha. Lo usa el Admin Panel para las pruebas
 * gratuitas vencidas y sin pago (regla que la empresa acepto al registrarse).
 * No se puede deshacer: no pasa por la papelera ni deja lapidas.
 *
 * Firestore no permite listar las subcolecciones desde el navegador, asi que se
 * recorren todas las colecciones conocidas de una empresa.
 */
import { collection, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { GLOBAL_COLLECTIONS, pathForCompany } from './tenant';
import { deleteGlobalDocument } from './firestore';
import { COLLECTIONS, type Company, type SystemUser } from '../types/models';

const BATCH_SIZE = 400;

/** Lapidas de la sincronizacion por cambios (no esta en COLLECTIONS: es interna de firestore.ts). */
const TOMBSTONES_COLLECTION = 'BD_DELETED';

/** Todas las colecciones que viven dentro de una empresa. */
const COMPANY_COLLECTIONS: string[] = [
  ...Object.values(COLLECTIONS).filter((name) => !GLOBAL_COLLECTIONS.has(name)),
  TOMBSTONES_COLLECTION,
];

export interface PurgeProgress {
  /** Coleccion que se esta borrando (o "users" / "company" al final). */
  step: string;
  deleted: number;
}

const deleteCollection = async (companyId: string, colName: string): Promise<number> => {
  const snap = await getDocs(collection(db, pathForCompany(companyId, colName)));
  for (let start = 0; start < snap.docs.length; start += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const docSnap of snap.docs.slice(start, start + BATCH_SIZE)) batch.delete(docSnap.ref);
    await batch.commit();
  }
  return snap.size;
};

/**
 * Borra todos los datos de la empresa. Las cuentas de acceso (Firebase Auth) de sus
 * usuarios no se pueden borrar desde el navegador: quedan sin empresa y sin acceso.
 */
export const purgeCompany = async (
  company: Company,
  users: SystemUser[],
  onProgress?: (progress: PurgeProgress) => void,
): Promise<number> => {
  let deleted = 0;
  for (const colName of COMPANY_COLLECTIONS) {
    deleted += await deleteCollection(company.id, colName);
    onProgress?.({ step: colName, deleted });
  }

  const members = users.filter((user) => user.companyId === company.id);
  for (const member of members) await deleteGlobalDocument(COLLECTIONS.SYSTEM_USERS, member.id);
  deleted += members.length;
  onProgress?.({ step: 'users', deleted });

  await deleteGlobalDocument(COLLECTIONS.COMPANIES, company.id);
  onProgress?.({ step: 'company', deleted: deleted + 1 });
  return deleted + 1;
};
