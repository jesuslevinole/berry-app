import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { COLLECTIONS, type AppRole, type PermissionAction, type SystemUser } from '../types/models';

interface AuthContextValue {
  firebaseUser: User | null;
  /** Documento del usuario en system_users (null si aun no existe). */
  profile: SystemUser | null;
  role: AppRole | null;
  /** true mientras se resuelve sesion + perfil + rol. */
  loading: boolean;
  /** Sin usuarios registrados en el sistema: el primero en entrar administra todo. */
  isBootstrapAdmin: boolean;
  can: (moduleId: string, action: PermissionAction) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<SystemUser | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [role, setRole] = useState<AppRole | null>(null);
  const [roleReady, setRoleReady] = useState(true);
  const [isBootstrapAdmin, setIsBootstrapAdmin] = useState(false);
  const [bypass, setBypass] = useState<boolean>(
    () => sessionStorage.getItem('berry-dev-bypass') === '1',
  );

  /* Sesion de Firebase Auth */
  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
  }, []);

  /* Perfil en system_users (busqueda por email, en tiempo real) */
  useEffect(() => {
    setProfile(null);
    setIsBootstrapAdmin(false);
    if (!firebaseUser?.email) {
      setProfileReady(true);
      return;
    }
    setProfileReady(false);
    const email = firebaseUser.email.toLowerCase();
    const q = query(collection(db, COLLECTIONS.SYSTEM_USERS), where('email', '==', email));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        if (!snap.empty) {
          const d = snap.docs[0];
          setProfile({ id: d.id, ...d.data() } as SystemUser);
          setIsBootstrapAdmin(false);
          setProfileReady(true);
          return;
        }
        /* Sin perfil: si la coleccion esta vacia, es el primer usuario (bootstrap). */
        void getDocs(query(collection(db, COLLECTIONS.SYSTEM_USERS), limit(1)))
          .then((all) => setIsBootstrapAdmin(all.empty))
          .finally(() => setProfileReady(true));
      },
      () => setProfileReady(true),
    );
    return unsubscribe;
  }, [firebaseUser]);

  /* Primer inicio de sesion: pasa de "Pending Invite" a "Active" */
  useEffect(() => {
    if (profile && profile.status === 'Pending Invite') {
      void updateDoc(doc(db, COLLECTIONS.SYSTEM_USERS, profile.id), { status: 'Active' }).catch(
        () => undefined,
      );
    }
  }, [profile]);

  /* Rol del perfil (en tiempo real) */
  useEffect(() => {
    setRole(null);
    if (!profile?.roleId) {
      setRoleReady(true);
      return;
    }
    setRoleReady(false);
    const unsubscribe = onSnapshot(
      doc(db, COLLECTIONS.ROLES, profile.roleId),
      (snap) => {
        setRole(snap.exists() ? ({ id: snap.id, ...snap.data() } as AppRole) : null);
        setRoleReady(true);
      },
      () => setRoleReady(true),
    );
    return unsubscribe;
  }, [profile?.roleId]);

  const loading = !authReady || (!!firebaseUser && (!profileReady || !roleReady));

  const value = useMemo<AuthContextValue>(() => {
    const can = (moduleId: string, action: PermissionAction): boolean => {
      if (!firebaseUser) return false;
      if (isBootstrapAdmin) return true;
      if (!profile || profile.status === 'Inactive') return false;
      const perm = role?.permissions?.find((p) => p.module === moduleId);
      if (!perm) return false;
      switch (action) {
        case 'view':
          return !!perm.canView;
        case 'add':
          return !!perm.canAdd;
        case 'edit':
          return !!perm.canEdit;
        case 'delete':
          return !!perm.canDelete;
        case 'documents':
          return !!perm.canDocuments;
        default:
          return false;
      }
    };
    return {
      firebaseUser,
      profile,
      role,
      loading,
      isBootstrapAdmin,
      can,
      login: async (email, password) => {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      logout: async () => {
        await signOut(auth);
      },
      resetPassword: async (email) => {
        await sendPasswordResetEmail(auth, email.trim());
      },
    };
  }, [firebaseUser, profile, role, loading, isBootstrapAdmin, bypass]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
