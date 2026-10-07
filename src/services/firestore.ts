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
  getDocFromCache,
  getDocsFromCache,
  Timestamp,
  onSnapshot,
  queryEqual,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
  type Query,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import type { BaseDoc } from '../types/models';
import { GLOBAL_COLLECTIONS, getActiveCompanyId, onCompanyChange, tenantPath } from './tenant';
import { recordLabel } from './recordLabels';


/* ---------- Registro de actividad + papelera (intercepcion central) ---------- */

const ACTIVITY_COLLECTION = 'BD_ACTIVITYLOG';
const TRASH_COLLECTION = 'BD_TRASH';
/** Colecciones internas que no se registran ni pasan por la papelera (evita bucles). */
/** Registro de borrados (lapidas) para que los demas equipos quiten lo borrado sin releer todo. */
const DELETED_COLLECTION = 'BD_DELETED';
const INTERNAL_COLLECTIONS = new Set([ACTIVITY_COLLECTION, TRASH_COLLECTION, DELETED_COLLECTION]);

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
  /** Nombre legible del registro (numero de orden, lote, nombre...). */
  label = '',
): Promise<void> {
  if (INTERNAL_COLLECTIONS.has(colName)) return;
  try {
    await addDoc(collection(db, tenantPath(ACTIVITY_COLLECTION)), {
      USER_EMAIL: currentUserEmail(),
      COLLECTION: colName,
      ACTION: action,
      DOC_ID: docId,
      LABEL: label,
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
  touchLocal(item.ORIGIN_COLLECTION, [item.ORIGIN_ID]);
  await deleteDoc(doc(db, tenantPath(TRASH_COLLECTION), trashId));
  void logActivity(
    item.ORIGIN_COLLECTION,
    'restore',
    item.ORIGIN_ID,
    'Restored from recycle bin',
    recordLabel(item.ORIGIN_COLLECTION, item.DATA),
  );
}

/** Elimina definitivamente un registro de la papelera. */
export async function deleteFromTrashForever(trashId: string): Promise<void> {
  await deleteDoc(doc(db, tenantPath(TRASH_COLLECTION), trashId));
}

/** Vacia la papelera completa (borrado definitivo, en lotes de 400). Devuelve cuantos borro. */
export async function emptyTrash(onProgress?: (deleted: number) => void): Promise<number> {
  const snap = await getDocs(collection(db, tenantPath(TRASH_COLLECTION)));
  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
    deleted += Math.min(400, snap.docs.length - i);
    onProgress?.(deleted);
  }
  return deleted;
}

/* ---------- Suscripciones compartidas (control de lecturas) ----------
 * Varias pantallas escuchan las mismas colecciones. Antes, cada vez que una
 * pantalla se abria se creaba una consulta nueva y Firestore cobraba otra vez
 * TODOS los documentos. Ahora:
 *  - Una sola consulta por coleccion/filtro, compartida por todas las pantallas.
 *  - Al cerrar la ultima pantalla que la usa, la consulta sigue viva unos minutos:
 *    si se vuelve a abrir, los datos salen al instante y sin cobrar lecturas.
 *  - Mientras esta viva solo se cobran los documentos que cambian.
 */

/** Tiempo que una consulta sigue viva sin pantallas que la usen. */
const LINGER_MS = 15 * 60 * 1000;

interface SharedListener {
  onData: (rows: BaseDoc[]) => void;
  onError?: (error: Error) => void;
}

interface SharedEntry {
  q: Query;
  rows: BaseDoc[] | null;
  error: Error | null;
  listeners: Set<SharedListener>;
  unsubscribe: Unsubscribe;
  timer: ReturnType<typeof setTimeout> | null;
}

const sharedEntries: SharedEntry[] = [];

/** Lecturas facturables aproximadas de esta sesion (documentos que llegaron del servidor). */
let serverReads = 0;
export const sessionReadCount = (): number => serverReads;
/* Diagnostico: en la consola del navegador, berryReads() muestra las lecturas de esta sesion. */
(globalThis as unknown as { berryReads?: () => number }).berryReads = sessionReadCount;

function closeEntry(entry: SharedEntry): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.unsubscribe();
  const index = sharedEntries.indexOf(entry);
  if (index >= 0) sharedEntries.splice(index, 1);
}

/** Cierra todas las consultas (al cerrar sesion o cambiar de empresa). */
export function closeAllSubscriptions(): void {
  for (const entry of [...sharedEntries]) closeEntry(entry);
  closeTombstones();
}

onCompanyChange(closeAllSubscriptions);
auth.onAuthStateChanged((user) => {
  if (!user) closeAllSubscriptions();
});


/* ---------- Sincronizacion por cambios (control de lecturas) ----------
 * Antes, cada vez que alguien abria la app despues de un rato, Firestore volvia a
 * cobrar TODOS los documentos de cada coleccion (ordenes, lineas, gastos, pagos...).
 * Ahora, para las colecciones completas:
 *  1. La primera vez en cada equipo se leen completas (una sola vez) y quedan en la
 *     cache local (IndexedDB).
 *  2. Las siguientes veces se cargan de la cache (sin costo) y solo se piden al
 *     servidor los documentos con updatedAt posterior a lo que ya se tiene.
 *  3. Los borrados llegan por BD_DELETED (una lapida por documento borrado).
 *  4. Por seguridad, cada 7 dias se vuelve a leer completa una vez.
 */

const FULL_RESYNC_MS = 7 * 24 * 60 * 60 * 1000;
/** Margen para no perder escrituras que llegan casi al mismo tiempo. */
const SAFETY_MS = 2 * 60 * 1000;
const SYNC_KEY_PREFIX = 'berry-sync-v1:';

const tombstoneId = (colName: string, id: string): string => `${colName}__${id}`.replace(/\//g, '_');
const tombstoneRef = (colName: string, id: string) => doc(db, tenantPath(DELETED_COLLECTION), tombstoneId(colName, id));
const tombstoneData = (colName: string, id: string) => ({ COLLECTION: colName, DOC_ID: id, AT: serverTimestamp() });

/** Deja la lapida de un documento borrado (mejor esfuerzo). */
async function recordDeletion(colName: string, id: string): Promise<void> {
  if (INTERNAL_COLLECTIONS.has(colName) || GLOBAL_COLLECTIONS.has(colName)) return;
  try {
    await setDoc(tombstoneRef(colName, id), tombstoneData(colName, id));
  } catch {
    /* Si falla, el resync semanal lo corrige. */
  }
}

const millisOf = (value: unknown): number =>
  value instanceof Timestamp ? value.toMillis() : typeof value === 'number' ? value : 0;

const docData = (d: DocumentSnapshot): BaseDoc =>
  ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }) as BaseDoc;

function readSyncMark(key: string): number {
  try {
    return Number(localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function writeSyncMark(key: string): void {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    /* Sin localStorage: se lee completo cada vez (comportamiento anterior). */
  }
}

/**
 * Carga inicial de una coleccion: de la cache si ya se sincronizo en este equipo
 * (gratis), si no del servidor (una vez). Devuelve los documentos.
 */
async function initialLoad(colName: string, q: Query): Promise<DocumentSnapshot[]> {
  const key = `${SYNC_KEY_PREFIX}${tenantPath(colName)}`;
  const mark = readSyncMark(key);
  if (mark && Date.now() - mark < FULL_RESYNC_MS) {
    try {
      const cached = await getDocsFromCache(q);
      if (!cached.empty) return cached.docs;
    } catch {
      /* Cache no disponible: se lee del servidor. */
    }
  }
  const snap = await getDocs(q);
  serverReads += snap.size;
  writeSyncMark(key);
  return snap.docs;
}

/* ---- Lapidas compartidas (un solo listener por empresa) ---- */
interface TombstoneState {
  company: string;
  byKey: Map<string, number>;
  ready: Promise<void>;
  unsubscribe: Unsubscribe;
  onChange: Set<() => void>;
}
let tombstones: TombstoneState | null = null;

function closeTombstones(): void {
  tombstones?.unsubscribe();
  tombstones = null;
}

function ensureTombstones(): TombstoneState {
  const company = getActiveCompanyId();
  if (tombstones && tombstones.company === company) return tombstones;
  closeTombstones();
  let stopped = false;
  let unsubLive: Unsubscribe = () => undefined;
  const state: TombstoneState = {
    company,
    byKey: new Map(),
    ready: Promise.resolve(),
    onChange: new Set(),
    unsubscribe: () => {
      stopped = true;
      unsubLive();
    },
  };
  const apply = (docs: DocumentSnapshot[]) => {
    for (const d of docs) {
      const data = d.data({ serverTimestamps: 'estimate' }) as { COLLECTION?: string; DOC_ID?: string; AT?: unknown } | undefined;
      if (data?.COLLECTION && data.DOC_ID) state.byKey.set(`${data.COLLECTION}/${data.DOC_ID}`, millisOf(data.AT) || Date.now());
    }
  };
  const base = collection(db, tenantPath(DELETED_COLLECTION));
  state.ready = (async () => {
    try {
      apply(await initialLoad(DELETED_COLLECTION, query(base)));
    } catch {
      /* Sin lapidas: solo se pierde la limpieza de borrados de otros equipos. */
    }
    if (stopped) return;
    const since = Math.max(0, Math.max(0, ...state.byKey.values()) - SAFETY_MS);
    unsubLive = onSnapshot(
      query(base, where('AT', '>=', Timestamp.fromMillis(since))),
      (snap) => {
        if (!snap.metadata.fromCache) serverReads += snap.docChanges().length;
        apply(snap.docChanges().map((c) => c.doc));
        for (const fn of state.onChange) fn();
      },
      () => undefined,
    );
  })();
  tombstones = state;
  return state;
}

/** Colecciones completas que se sincronizan por cambios. */
const deltaEligible = (colName: string, constraints: QueryConstraint[]): boolean =>
  constraints.length === 0 && !INTERNAL_COLLECTIONS.has(colName) && !GLOBAL_COLLECTIONS.has(colName) && !!getActiveCompanyId();

/**
 * Escrituras de este equipo: el filtro por updatedAt no ve un cambio propio hasta que
 * el servidor le pone la hora, asi que se toma de la cache local al instante.
 */
const localRefreshers = new Map<string, Set<(ids: string[]) => void>>();
function touchLocal(colName: string, ids: string[]): void {
  const set = localRefreshers.get(colName);
  if (!set || ids.length === 0) return;
  setTimeout(() => {
    for (const fn of set) fn(ids);
  }, 0);
}

/** Arranca la sincronizacion por cambios de una coleccion completa. */
function startDeltaEntry(entry: SharedEntry, colName: string): void {
  const base = collection(db, tenantPath(colName));
  const docs = new Map<string, BaseDoc>();
  const stones = ensureTombstones();
  let stopped = false;
  let unsubDelta: Unsubscribe = () => undefined;

  const emit = () => {
    if (stopped) return;
    const rows: BaseDoc[] = [];
    for (const d of docs.values()) {
      const deletedAt = stones.byKey.get(`${colName}/${d.id}`);
      /* Borrado despues de su ultima modificacion (si se restauro, la modificacion es posterior). */
      if (deletedAt && deletedAt >= millisOf((d as { updatedAt?: unknown }).updatedAt)) continue;
      rows.push(d);
    }
    entry.rows = rows;
    entry.error = null;
    for (const l of entry.listeners) l.onData(rows.slice());
  };
  stones.onChange.add(emit);

  /* Vuelve a tomar de la cache local los documentos indicados (cambios propios). */
  const refresh = (ids: string[]) => {
    void Promise.all(
      ids.map(async (id) => {
        try {
          const snap = await getDocFromCache(doc(db, tenantPath(colName), id));
          if (snap.exists()) docs.set(id, docData(snap));
          else docs.delete(id);
        } catch {
          /* No esta en la cache: llegara por el listener. */
        }
      }),
    ).then(emit);
  };
  const refreshers = localRefreshers.get(colName) ?? new Set();
  refreshers.add(refresh);
  localRefreshers.set(colName, refreshers);

  entry.unsubscribe = () => {
    stopped = true;
    stones.onChange.delete(emit);
    refreshers.delete(refresh);
    unsubDelta();
  };

  void (async () => {
    try {
      const [initial] = await Promise.all([initialLoad(colName, query(base)), stones.ready]);
      if (stopped) return;
      for (const d of initial) docs.set(d.id, docData(d));
      emit();
      let maxMs = 0;
      for (const d of docs.values()) maxMs = Math.max(maxMs, millisOf((d as { updatedAt?: unknown }).updatedAt));
      const since = Math.max(0, maxMs - SAFETY_MS);
      unsubDelta = onSnapshot(
        query(base, where('updatedAt', '>=', Timestamp.fromMillis(since))),
        (snap) => {
          if (!snap.metadata.fromCache) serverReads += snap.docChanges().length;
          const recheck: string[] = [];
          for (const change of snap.docChanges()) {
            if (change.type === 'removed') {
              /* Sale del filtro al editarse aqui (hora del servidor pendiente) o al borrarse:
                 se consulta la cache local para saber cual de los dos fue. */
              recheck.push(change.doc.id);
              continue;
            }
            docs.set(change.doc.id, docData(change.doc));
          }
          emit();
          if (recheck.length) refresh(recheck);
        },
        (err) => {
          entry.error = err;
          for (const l of entry.listeners) l.onError?.(err);
          closeEntry(entry);
        },
      );
      if (stopped) unsubDelta();
    } catch (err) {
      entry.error = err as Error;
      for (const l of entry.listeners) l.onError?.(err as Error);
      closeEntry(entry);
    }
  })();
}

export function subscribeToCollection<T extends BaseDoc>(
  colName: string,
  onData: (rows: T[]) => void,
  onError?: (error: Error) => void,
  constraints: QueryConstraint[] = [],
): Unsubscribe {
  const q = query(collection(db, tenantPath(colName)), ...constraints);
  let entry = sharedEntries.find((e) => queryEqual(e.q, q));

  if (!entry && deltaEligible(colName, constraints)) {
    const created: SharedEntry = { q, rows: null, error: null, listeners: new Set(), unsubscribe: () => undefined, timer: null };
    sharedEntries.push(created);
    startDeltaEntry(created, colName);
    entry = created;
  }

  if (!entry) {
    const created: SharedEntry = { q, rows: null, error: null, listeners: new Set(), unsubscribe: () => undefined, timer: null };
    created.unsubscribe = onSnapshot(
      q,
      (snap) => {
        if (!snap.metadata.fromCache) serverReads += snap.docChanges().length;
        created.rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BaseDoc);
        created.error = null;
        for (const l of created.listeners) l.onData(created.rows.slice());
      },
      (err) => {
        created.error = err;
        for (const l of created.listeners) l.onError?.(err);
        /* Una consulta con error no se reutiliza: la siguiente pantalla la reintenta. */
        closeEntry(created);
      },
    );
    sharedEntries.push(created);
    entry = created;
  }

  const current = entry;
  if (current.timer) {
    clearTimeout(current.timer);
    current.timer = null;
  }
  const listener: SharedListener = { onData: onData as (rows: BaseDoc[]) => void, onError };
  current.listeners.add(listener);
  /* Datos ya cargados: se entregan de inmediato, sin volver a leer. */
  if (current.rows) {
    const rows = current.rows.slice();
    queueMicrotask(() => {
      if (current.listeners.has(listener)) listener.onData(rows);
    });
  }

  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0 && sharedEntries.includes(current)) {
      current.timer = setTimeout(() => closeEntry(current), LINGER_MS);
    }
  };
}

export async function listDocuments<T extends BaseDoc>(
  colName: string,
  constraints: QueryConstraint[] = [],
): Promise<T[]> {
  const snap = await getDocs(query(collection(db, tenantPath(colName)), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

/** Lee un solo documento por id (1 lectura). */
export async function getDocument<T extends BaseDoc>(colName: string, id: string): Promise<T | null> {
  const snap = await getDoc(doc(db, tenantPath(colName), id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null;
}

/** Lee varios documentos por id (1 lectura por documento, no la coleccion completa). */
export async function getDocumentsById<T extends BaseDoc>(colName: string, ids: string[]): Promise<Map<string, T>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const found: (T | null)[] = await Promise.all(unique.map((id) => getDocument<T>(colName, id)));
  const map = new Map<string, T>();
  for (const d of found) if (d) map.set(d.id, d);
  return map;
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
  touchLocal(colName, [ref.id]);
  void logActivity(colName, 'create', ref.id, '', recordLabel(colName, data as Record<string, unknown>));
  return ref.id;
}

export async function updateDocument<T extends BaseDoc>(
  colName: string,
  id: string,
  data: Partial<Omit<T, 'id'>>,
  options: { silent?: boolean } = {},
): Promise<void> {
  const pending = updateDoc(doc(db, tenantPath(colName), id), { ...data, updatedAt: serverTimestamp() });
  touchLocal(colName, [id]);
  await pending;
  /* silent: recalculos automaticos de totales no se registran como accion del usuario. */
  if (!options.silent) void logActivity(colName, 'update', id, '', recordLabel(colName, data as Record<string, unknown>));
}

/**
 * Borrado suave: el registro se copia a la papelera (BD_TRASH) antes de
 * eliminarse, para poder restaurarlo. Las colecciones internas se borran directo.
 */
export async function deleteDocument(colName: string, id: string): Promise<void> {
  let label = '';
  if (!INTERNAL_COLLECTIONS.has(colName)) {
    try {
      const snap = await getDoc(doc(db, tenantPath(colName), id));
      if (snap.exists()) {
        label = recordLabel(colName, snap.data());
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
  const removing = deleteDoc(doc(db, tenantPath(colName), id));
  touchLocal(colName, [id]);
  await removing;
  void recordDeletion(colName, id);
  void logActivity(colName, 'delete', id, '', label);
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
  const touched: string[] = [];

  for (const ex of existing) {
    if (!keep.has(ex.id)) {
      batch.delete(doc(db, tenantPath(colName), ex.id));
      batch.set(tombstoneRef(colName, ex.id), tombstoneData(colName, ex.id));
      touched.push(ex.id);
    }
  }
  for (const row of rows) {
    const { id, ...data } = row;
    const ref = id ? doc(db, tenantPath(colName), id) : doc(collection(db, tenantPath(colName)));
    batch.set(ref, { ...data, [parentField]: parentId, updatedAt: serverTimestamp() }, { merge: true });
    touched.push(ref.id);
  }
  const committing = batch.commit();
  touchLocal(colName, touched);
  await committing;
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
    touchLocal(colName, chunk.map((r) => r.id).filter((x): x is string => !!x));
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
  const pending = setDoc(doc(db, tenantPath(colName), id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  touchLocal(colName, [id]);
  await pending;
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
  touchLocal(colName, [ref.id]);
  return ref.id;
}

export { where };
