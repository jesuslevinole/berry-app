/**
 * Capa de acceso a datos: CRUD generico y tipado sobre Firestore.
 * Ninguna vista habla con Firestore directamente; todo pasa por aqui.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
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
import { db } from '../firebase/config';
import type { BaseDoc } from '../types/models';

export function subscribeToCollection<T extends BaseDoc>(
  colName: string,
  onData: (rows: T[]) => void,
  onError?: (error: Error) => void,
  constraints: QueryConstraint[] = [],
): Unsubscribe {
  const q = query(collection(db, colName), ...constraints);
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
  const snap = await getDocs(query(collection(db, colName), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

export async function createDocument<T extends BaseDoc>(
  colName: string,
  data: Omit<T, 'id'>,
): Promise<string> {
  const ref = await addDoc(collection(db, colName), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateDocument<T extends BaseDoc>(
  colName: string,
  id: string,
  data: Partial<Omit<T, 'id'>>,
): Promise<void> {
  await updateDoc(doc(db, colName, id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteDocument(colName: string, id: string): Promise<void> {
  await deleteDoc(doc(db, colName, id));
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
    if (!keep.has(ex.id)) batch.delete(doc(db, colName, ex.id));
  }
  for (const row of rows) {
    const { id, ...data } = row;
    const ref = id ? doc(db, colName, id) : doc(collection(db, colName));
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
      const ref = id ? doc(db, colName, id) : doc(collection(db, colName));
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
  await setDoc(doc(db, colName, id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
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
  const ref = doc(collection(db, colName));
  setDoc(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch(
    (error: Error) => onError?.(error),
  );
  return ref.id;
}

export { where };
