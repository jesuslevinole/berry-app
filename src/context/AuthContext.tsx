import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
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
import { resendPasswordReset } from '../services/userAuthService';
import { COLLECTIONS, type AdminCapability, type AppRole, type PermissionAction, type SystemUser } from '../types/models';

interface AuthContextValue {
  firebaseUser: User | null;
  /** Documento del usuario en system_users (null si aun no existe). */
  profile: SystemUser | null;
  role: AppRole | null;
  /** true mientras se resuelve sesion + perfil + rol. */
  loading: boolean;
  /** Sin usuarios registrados en el sistema: el primero en entrar administra todo. */
  isBootstrapAdmin: boolean;
  /** Modo bypass de DESARROLLO: sesion local sin Firebase Auth, acceso total. */
  bypass: boolean;
  enterAsGuest: () => void;
  can: (moduleId: string, action: PermissionAction) => boolean;
  /** Capacidades del configurador, evaluadas SIEMPRE sobre el usuario real. */
  canAdmin: (cap: AdminCapability) => boolean;
  /** Perfil que se esta suplantando con "View as" (null = ninguno). */
  viewAsProfile: SystemUser | null;
  setViewAs: (userId: string | null) => void;
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
  const [viewAsUserId, setViewAsUserId] = useState<string | null>(
    () => sessionStorage.getItem('berry-view-as') || null,
  );
  const [viewAsProfile, setViewAsProfile] = useState<SystemUser | null>(null);
  const [viewAsRole, setViewAsRole] = useState<AppRole | null>(null);
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

  /* "View as": perfil del usuario suplantado (tiempo real) */
  useEffect(() => {
    setViewAsProfile(null);
    if (!viewAsUserId) return;
    return onSnapshot(
      doc(db, COLLECTIONS.SYSTEM_USERS, viewAsUserId),
      (snap) => setViewAsProfile(snap.exists() ? ({ id: snap.id, ...snap.data() } as SystemUser) : null),
      () => setViewAsProfile(null),
    );
  }, [viewAsUserId]);

  /* "View as": rol del usuario suplantado */
  useEffect(() => {
    setViewAsRole(null);
    if (!viewAsProfile?.roleId) return;
    return onSnapshot(
      doc(db, COLLECTIONS.ROLES, viewAsProfile.roleId),
      (snap) => setViewAsRole(snap.exists() ? ({ id: snap.id, ...snap.data() } as AppRole) : null),
      () => setViewAsRole(null),
    );
  }, [viewAsProfile?.roleId]);

  const loading = !authReady || (!!firebaseUser && (!profileReady || !roleReady));

  const value = useMemo<AuthContextValue>(() => {
    const viewingAs = !!viewAsUserId && !!viewAsProfile;
    const can = (moduleId: string, action: PermissionAction): boolean => {
      /* Suplantacion activa: evaluar EXACTAMENTE lo que ve el otro usuario. */
      if (viewingAs) {
        if (viewAsProfile.status === 'Inactive') return false;
        const vperm = viewAsRole?.permissions?.find((p) => p.module === moduleId);
        if (!vperm) return false;
        switch (action) {
          case 'view': return !!vperm.canView;
          case 'add': return !!vperm.canAdd;
          case 'edit': return !!vperm.canEdit;
          case 'delete': return !!vperm.canDelete;
          case 'documents': return !!vperm.canDocuments;
          default: return false;
        }
      }
      if (bypass) return true;
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
      loading: bypass ? false : loading,
      isBootstrapAdmin,
      bypass,
      enterAsGuest: () => {
        sessionStorage.setItem('berry-dev-bypass', '1');
        setBypass(true);
      },
      can,
      canAdmin: (cap) => {
        if (bypass || isBootstrapAdmin) return true;
        if (!firebaseUser || !profile || profile.status === 'Inactive') return false;
        return !!role?.adminPerms?.[cap];
      },
      viewAsProfile: viewingAs ? viewAsProfile : null,
      setViewAs: (userId) => {
        if (userId) sessionStorage.setItem('berry-view-as', userId);
        else sessionStorage.removeItem('berry-view-as');
        setViewAsUserId(userId);
      },
      login: async (email, password) => {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      logout: async () => {
        sessionStorage.removeItem('berry-dev-bypass');
        sessionStorage.removeItem('berry-view-as');
        setViewAsUserId(null);
        setBypass(false);
        await signOut(auth);
      },
      resetPassword: async (email) => {
        await resendPasswordReset(email.trim());
      },
    };
  }, [firebaseUser, profile, role, loading, isBootstrapAdmin, bypass, viewAsUserId, viewAsProfile, viewAsRole]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
