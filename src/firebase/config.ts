import { initializeApp } from 'firebase/app';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

/** Config exportada tambien para instancias secundarias (creacion de usuarios sin cerrar sesion). */
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
/**
 * Cache local persistente (IndexedDB): al recargar la pagina o volver a una pantalla,
 * Firestore reanuda las consultas desde la cache y solo cobra los documentos que
 * cambiaron, en vez de volver a leer colecciones completas. Si el navegador no
 * permite IndexedDB (modo privado), se usa la cache normal en memoria.
 */
function createDb(): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = createDb();
export const auth = getAuth(app);
