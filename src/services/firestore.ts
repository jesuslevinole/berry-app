/**
 * Capa de acceso a datos: CRUD generico y tipado sobre Firestore.
 * Ninguna vista habla con Firestore directamente; todo pasa por aqui.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import type { BaseDoc } from '../types/models';
import { tenantPath } from './tenant';


/* ---------- Registro de actividad + papelera (intercepcion central) ---------- */

const ACTIVITY_COLLECTION = 'BD_ACTIVITYLOG';
const TRASH_COLLECTION = 'BD_TRASH';
/** Colecciones internas que no se registran ni pasan por la papelera (evita bucles). */
const INTERNAL_COLLECTIONS = new Set([ACTIVITY_COLLECTION, TRASH_COLLECTION]);

const currentUserEmail = (): string => auth.currentUser?.email ?? 'System';

/**
 * Registra una accion en el historial de actividad (mejor esfuerzo: nunca
 * bloquea ni rompe la operacion principal). Patron del proyecto Roelca.
 */
export async function logActivity(
  colName: string,
  action: 'create' | 'update' | 'delete' | 'restore',
  docId: string,
  detail = '',
): Promise<void> {
  if (INTERNAL_COLLECTIONS.has(colName)) return;
  try {
    await addDoc(collection(db, tenantPath(ACTIVITY_COLLECTION)), {
      USER_EMAIL: currentUserEmail(),
      COLLECTION: colName,
      ACTION: action,
      DOC_ID: docId,
      DETAIL: detail,
      DATE: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
  } catch {
    /* El historial nunca debe romper la operacion del usuario. */
  }
}

/** Restaura un registro de la papelera a su coleccion original (mismo id). */
export async function restoreFromTrash(trashId: string): Promise<void> {
  const snap = await getDoc(doc(db, tenantPath(TRASH_COLLECTION), trashId));
  if (!snap.exists()) throw new Error('Trash record not found');
  const item = snap.data() as { ORIGIN_COLLECTION: string; ORIGIN_ID: string; DATA: Record<string, unknown> };
  await setDoc(doc(db, tenantPath(item.ORIGIN_COLLECTION), item.ORIGIN_ID), { ...item.DATA, updatedAt: serverTimestamp() });
  await deleteDoc(doc(db, tenantPath(TRASH_COLLECTION), trashId));
  void logActivity(item.ORIGIN_COLLECTION, 'restore', item.ORIGIN_ID, 'Restored from recycle bin');
}

/** Elimina definitivamente un registro de la papelera. */
export async function deleteFromTrashForever(trashId: string): Promise<void> {
  await deleteDoc(doc(db, tenantPath(TRASH_COLLECTION), trashId));
}

export function subscribeToCollection<T extends BaseDoc>(
  colName: string,
  onData: (rows: T[]) => void,
  onError?: (error: Error) => void,
  constraints: QueryConstraint[] = [],
): Unsubscribe {
  const q = query(collection(db, tenantPath(colName)), ...constraints);
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)),
    (err) => onError?.(err),
  );
}

export async function listDocuments<T extends BaseDoc>(
  colName: string,
  constraints: QueryConstraint[] = [],
): Promise<T[]> {
  const snap = await getDocs(query(collection(db, tenantPath(colName)), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

export async function createDocument<T extends BaseDoc>(
  colName: string,
  data: Omit<T, 'id'>,
): Promise<string> {
  const ref = await addDoc(collection(db, tenantPath(colName)), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  void logActivity(colName, 'create', ref.id);
  return ref.id;
}

export async function updateDocument<T extends BaseDoc>(
  colName: string,
  id: string,
  data: Partial<Omit<T, 'id'>>,
  options: { silent?: boolean } = {},
): Promise<void> {
  await updateDoc(doc(db, tenantPath(colName), id), { ...data, updatedAt: serverTimestamp() });
  /* silent: recalculos automaticos de totales no se registran como accion del usuario. */
  if (!options.silent) void logActivity(colName, 'update', id);
}

/**
 * Borrado suave: el registro se copia a la papelera (BD_TRASH) antes de
 * eliminarse, para poder restaurarlo. Las colecciones internas se borran directo.
 */
export async function deleteDocument(colName: string, id: string): Promise<void> {
  if (!INTERNAL_COLLECTIONS.has(colName)) {
    try {
      const snap = await getDoc(doc(db, tenantPath(colName), id));
      if (snap.exists()) {
        await addDoc(collection(db, tenantPath(TRASH_COLLECTION)), {
          ORIGIN_COLLECTION: colName,
          ORIGIN_ID: id,
          DATA: snap.data(),
          DELETED_BY: currentUserEmail(),
          DELETED_AT: new Date().toISOString(),
          createdAt: serverTimestamp(),
        });
      }
    } catch {
      /* Si la papelera falla, el borrado continua igual. */
    }
  }
  await deleteDoc(doc(db, tenantPath(colName), id));
  void logActivity(colName, 'delete', id);
}

/**
 * Sincroniza las lineas hijas de un documento padre (patron encabezado/detalle):
 * borra las que ya no existen y crea/actualiza las demas, todo en un batch atomico.
 */
export async function replaceChildren(
  colName: string,
  parentField: string,
  parentId: string,
  rows: Array<Record<string, unknown> & { id?: string }>,
): Promise<void> {
  const existing = await listDocuments<BaseDoc>(colName, [where(parentField, '==', parentId)]);
  const keep = new Set(rows.filter((r) => r.id).map((r) => r.id as string));
  const batch = writeBatch(db);

  for (const ex of existing) {
    if (!keep.has(ex.id)) batch.delete(doc(db, tenantPath(colName), ex.id));
  }
  for (const row of rows) {
    const { id, ...data } = row;
    const ref = id ? doc(db, tenantPath(colName), id) : doc(collection(db, tenantPath(colName)));
    batch.set(ref, { ...data, [parentField]: parentId, updatedAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();
}

/**
 * Escritura masiva usada por la importacion de CSV.
 * Si la fila trae `id` (el ID original de AppSheet) se respeta como ID del documento
 * en Firestore, de modo que todas las llaves foraneas del archivo siguen siendo validas.
 * Se escribe con merge, asi que reimportar el mismo archivo actualiza y nunca duplica.
 */
export async function bulkUpsert(
  colName: string,
  rows: Array<{ id?: string } & Record<string, unknown>>,
  chunkSize = 400,
): Promise<number> {
  let written = 0;

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const batch = writeBatch(db);

    for (const row of chunk) {
      const { id, ...data } = row;
      const ref = id ? doc(db, tenantPath(colName), id) : doc(collection(db, tenantPath(colName)));
      batch.set(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    }

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

/** Crea o reemplaza un documento con un ID conocido (por ejemplo, el de AppSheet). */
export async function setDocumentWithId(
  colName: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await setDoc(doc(db, tenantPath(colName), id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Creacion local-first: genera el ID en el cliente, dispara la escritura en
 * segundo plano y devuelve el ID de inmediato (para seleccionarlo en un form).
 */
export function createDocumentLocalFirst(
  colName: string,
  data: Record<string, unknown>,
  onError?: (error: Error) => void,
): string {
  const ref = doc(collection(db, tenantPath(colName)));
  setDoc(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch(
    (error: Error) => onError?.(error),
  );
  return ref.id;
}

export { where };
