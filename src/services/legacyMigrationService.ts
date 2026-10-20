/**
 * Migracion unica del modelo de una sola empresa: copia las colecciones de la
 * raiz de Firestore al subarbol companies/{id}. Nunca borra el original, asi que
 * se puede repetir y verificar antes de limpiar.
 */
import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { pathForCompany } from './tenant';
import { COLLECTIONS } from '../types/models';

const BATCH_SIZE = 400;

/** Colecciones de negocio que viven dentro de cada empresa (para migrar datos legados). */
export const LEGACY_TENANT_COLLECTIONS: string[] = [
  COLLECTIONS.PURCHASE_ORDER,
  COLLECTIONS.PURCHASE_DETAILS,
  COLLECTIONS.SALES_ORDER,
  COLLECTIONS.SALES_ORDER_DETAIL,
  COLLECTIONS.EXPENSES,
  COLLECTIONS.PAYMENT_SALES,
  COLLECTIONS.PAYMENT_BILL,
  COLLECTIONS.CUSTOMER,
  COLLECTIONS.USERS,
  COLLECTIONS.CATEGORY_BILL,
  COLLECTIONS.GROWER,
  COLLECTIONS.CARRIER,
  COLLECTIONS.LOCATIONS,
  COLLECTIONS.COMMODITIES,
  COLLECTIONS.SUPPLIERS,
  COLLECTIONS.SHIPVIA,
  COLLECTIONS.TERMSHIPPING,
  COLLECTIONS.PAYMENT_METHOD,
  COLLECTIONS.PAYMENTTERM,
  COLLECTIONS.CHECKS,
  COLLECTIONS.ROLES,
  COLLECTIONS.APP_SETTINGS,
  COLLECTIONS.COMPANY,
];

/** Copia una coleccion de la raiz a la empresa (merge por id). Devuelve cuantos documentos copio. */
export const copyLegacyCollection = async (companyId: string, colName: string): Promise<number> => {
  const snap = await getDocs(collection(db, colName));
  let written = 0;
  for (let start = 0; start < snap.docs.length; start += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const d of snap.docs.slice(start, start + BATCH_SIZE)) {
      batch.set(doc(db, pathForCompany(companyId, colName), d.id), { ...d.data(), updatedAt: serverTimestamp() }, { merge: true });
      written += 1;
    }
    await batch.commit();
  }
  return written;
};
