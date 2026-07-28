/**
 * Invitaciones de usuarios sin Admin SDK:
 * se crea la cuenta de Auth en una app secundaria (para no cerrar la sesion del
 * administrador) y se envia el email de "establecer contraseña" con reset.
 *
 * El email incluye una continue URL: al terminar de establecer su contraseña,
 * Firebase muestra un boton "Continuar" que lleva al usuario directo a la app.
 */
import { initializeApp, deleteApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  sendPasswordResetEmail,
  signOut,
  type ActionCodeSettings,
} from 'firebase/auth';
import { auth, firebaseConfig } from '../firebase/config';

export interface CreateUserResult {
  uid: string | null;
  alreadyExisted: boolean;
}

/**
 * URL a la que Firebase redirige despues de establecer la contraseña.
 * Se puede fijar con VITE_APP_URL (recomendado en produccion); si no existe,
 * usa el origen desde donde el administrador envia la invitacion.
 * IMPORTANTE: el dominio debe estar en Authentication > Settings > Authorized domains.
 */
const appUrl = (): string =>
  (import.meta.env.VITE_APP_URL as string | undefined)?.trim() || window.location.origin;

const actionCodeSettings = (): ActionCodeSettings => ({
  url: appUrl(),
  handleCodeInApp: false,
});

const randomTempPassword = (): string =>
  `Tmp-${crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;

/** Crea la cuenta de Auth (si no existe) y envia el enlace para establecer contraseña. */
export async function createUserWithResetEmail(email: string): Promise<CreateUserResult> {
  const secondary = initializeApp(firebaseConfig, `invite-${Date.now()}`);
  const secondaryAuth = getAuth(secondary);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, randomTempPassword());
    await signOut(secondaryAuth);
    await sendPasswordResetEmail(auth, email, actionCodeSettings());
    return { uid: cred.user.uid, alreadyExisted: false };
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (code === 'auth/email-already-in-use') {
      await sendPasswordResetEmail(auth, email, actionCodeSettings());
      return { uid: null, alreadyExisted: true };
    }
    throw error;
  } finally {
    await deleteApp(secondary);
  }
}

/** Reenvia el email de establecer/restablecer contraseña a una cuenta existente. */
export async function resendPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email, actionCodeSettings());
}
