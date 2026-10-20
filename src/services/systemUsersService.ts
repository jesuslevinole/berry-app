/**
 * Membresias de usuarios (coleccion global system_users). Cada documento es la
 * membresia de un email en UNA empresa (companyId); un mismo email puede tener
 * varias. Ids:
 *  - pending_<companyId>__<email>: dado de alta, aun sin invitacion enviada.
 *  - <uid>: membresia principal de una cuenta de Auth nueva.
 *  - <uid>__<companyId>: membresias adicionales (las reindexa AuthContext al entrar).
 */
import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { COLLECTIONS, type SystemUser } from '../types/models';

type SystemUserData = Partial<Omit<SystemUser, 'id'>>;

const userRef = (id: string) => doc(db, COLLECTIONS.SYSTEM_USERS, id);

/**
 * Id del alta pendiente. Incluye la empresa: con solo el email, la segunda empresa
 * que agregaba el mismo correo pisaba la membresia de la primera.
 */
export const pendingUserId = (companyId: string, email: string): string =>
  `pending_${companyId}__${email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '_')}`;

/** Da de alta un usuario en la empresa (sin cuenta de Auth todavia). */
export const createPendingUser = async (companyId: string, data: SystemUserData): Promise<string> => {
  const id = pendingUserId(companyId, data.email ?? '');
  await setDoc(userRef(id), {
    ...data,
    companyId,
    status: 'Pending Invite',
    inviteSent: false,
    createdAt: new Date().toISOString(),
  });
  return id;
};

export const updateSystemUser = async (id: string, data: SystemUserData): Promise<void> => {
  await updateDoc(userRef(id), data);
};

/** Mueve la membresia a otro id (cambio de email pendiente, o al crear la cuenta de Auth). */
export const moveSystemUser = async (fromId: string, toId: string, data: SystemUserData): Promise<void> => {
  await setDoc(userRef(toId), data);
  await deleteDoc(userRef(fromId));
};

export const deleteSystemUser = async (id: string): Promise<void> => {
  await deleteDoc(userRef(id));
};
