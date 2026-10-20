/**
 * Administradores de la plataforma (Admin Panel). Los duenos fijos estan en
 * PLATFORM_ADMIN_EMAILS; los demas viven en platform_admins/{email}.
 * Coleccion global y diminuta: se lee con getDocs/getDoc puntuales (no por
 * sincronizacion de cambios) y se escribe directo, sin historial de empresa.
 */
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { isPlatformAdminEmail } from './tenant';
import { COLLECTIONS, type PlatformAdmin } from '../types/models';

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const adminRef = (email: string) => doc(db, COLLECTIONS.PLATFORM_ADMINS, normalizeEmail(email));

/** true si el email fue agregado como administrador (sin contar a los duenos fijos). */
export const isAddedPlatformAdmin = async (email: string): Promise<boolean> => {
  try {
    const snap = await getDoc(adminRef(email));
    return snap.exists();
  } catch {
    /* Las reglas niegan la lectura a quien no es administrador. */
    return false;
  }
};

export const listPlatformAdmins = async (): Promise<PlatformAdmin[]> => {
  const snap = await getDocs(collection(db, COLLECTIONS.PLATFORM_ADMINS));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as PlatformAdmin)
    .sort((a, b) => a.email.localeCompare(b.email));
};

export const addPlatformAdmin = async (email: string, addedBy: string): Promise<void> => {
  const clean = normalizeEmail(email);
  if (isPlatformAdminEmail(clean)) return;
  await setDoc(adminRef(clean), { email: clean, addedBy, addedAt: new Date().toISOString() });
};

export const removePlatformAdmin = async (email: string): Promise<void> => {
  await deleteDoc(adminRef(email));
};
