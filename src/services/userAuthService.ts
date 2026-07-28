/**
 * Invitaciones de usuarios sin Admin SDK:
 * se crea la cuenta de Auth en una app secundaria (para no cerrar la sesion del
 * administrador) y se envia el email de "establecer contraseña" con reset.
 */
import { initializeApp, deleteApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';
import { auth, firebaseConfig } from '../firebase/config';

export interface CreateUserResult {
  uid: string | null;
  alreadyExisted: boolean;
}

const randomTempPassword = (): string =>
  `Tmp-${crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;

/** Crea la cuenta de Auth (si no existe) y envia el enlace para establecer contraseña. */
export async function createUserWithResetEmail(email: string): Promise<CreateUserResult> {
  const secondary = initializeApp(firebaseConfig, `invite-${Date.now()}`);
  const secondaryAuth = getAuth(secondary);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, randomTempPassword());
    await signOut(secondaryAuth);
    await sendPasswordResetEmail(auth, email);
    return { uid: cred.user.uid, alreadyExisted: false };
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (code === 'auth/email-already-in-use') {
      await sendPasswordResetEmail(auth, email);
      return { uid: null, alreadyExisted: true };
    }
    throw error;
  } finally {
    await deleteApp(secondary);
  }
}

/** Reenvia el email de establecer/restablecer contraseña a una cuenta existente. */
export async function resendPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}
