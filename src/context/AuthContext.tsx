import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, limit, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { resendPasswordReset } from '../services/userAuthService';
import { isAddedPlatformAdmin } from '../services/platformAdminService';
import { isOnFreeTrial } from '../services/billingService';
import { setTrialLimitsActive } from '../services/trialLimits';
import { getActiveCompanyId, isPlatformAdminEmail, setActiveCompanyId, tenantPath } from '../services/tenant';
import { COLLECTIONS, type Company, type AdminCapability, type AppRole, type PermissionAction, type SystemUser } from '../types/models';

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
  /** Empresa activa de la sesion (SaaS). */
  companyId: string;
  /** true si el usuario administra la plataforma (Admin Panel), con su email ya verificado. */
  isPlatformAdmin: boolean;
  /** Administrador de la plataforma cuyo email aun no esta verificado: el Admin Panel le pide verificarlo. */
  platformNeedsVerification: boolean;
  /** Sesion abierta en el Admin Panel (fuera de toda empresa). */
  consoleMode: boolean;
  /** Ficha de la empresa activa (suscripcion, nombre); null mientras carga. */
  company: Company | null;
  /** Empresas en las que este email tiene acceso (una membresia por empresa). */
  memberships: SystemUser[];
  /** true mientras el login espera que confirme la empresa (paso "Company"). */
  needsCompanyChoice: boolean;
  /** Entra a una de sus empresas (paso "Company" del login). */
  chooseCompany: (companyId: string) => void;
  /** Entra al Admin Panel de la plataforma (paso "Company" del login). */
  chooseConsole: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const COMPANY_OVERRIDE_KEY = 'berry-company-override';
/** Valor de la eleccion del login que abre el Admin Panel en vez de una empresa. */
const PLATFORM_CONSOLE_ID = '__platform__';

/** Resultado de buscar el email en platform_admins (se guarda con el email consultado). */
interface AdminLookup {
  email: string;
  isAdmin: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<SystemUser | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [role, setRole] = useState<AppRole | null>(null);
  const [roleReady, setRoleReady] = useState(true);
  const [isBootstrapAdmin, setIsBootstrapAdmin] = useState(false);
  /* Empresa activa de la sesion (SaaS multi-empresa). */
  const [companyId, setCompanyId] = useState('');
  const [company, setCompany] = useState<Company | null>(null);
  /* Todas las membresias del email conectado (una por empresa). */
  const [memberships, setMemberships] = useState<SystemUser[]>([]);
  /* Empresa confirmada en el login. Se guarda para que recargar no la vuelva a
     pedir y se borra al cerrar sesion: la empresa solo se cambia desde el login. */
  const [overrideCompanyId, setOverrideCompanyId] = useState<string>(
    () => localStorage.getItem(COMPANY_OVERRIDE_KEY) ?? '',
  );
  const [adminLookup, setAdminLookup] = useState<AdminLookup>({ email: '', isAdmin: false });
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
      /* Sin sesion: no queda ninguna empresa de la cuenta anterior. */
      setMemberships([]);
      setCompanyId('');
      setProfileReady(true);
      return;
    }
    setProfileReady(false);
    const email = firebaseUser.email.toLowerCase();
    /* El Admin Panel no abre ninguna empresa. */
    const companyOverride = overrideCompanyId === PLATFORM_CONSOLE_ID ? '' : overrideCompanyId;
    const isListedAdmin = isPlatformAdminEmail(email) || (adminLookup.email === email && adminLookup.isAdmin);
    const q = query(collection(db, COLLECTIONS.SYSTEM_USERS), where('email', '==', email));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        if (!snap.empty) {
          /* Un mismo email puede estar dado de alta en varias empresas: cada
             documento de system_users es una membresia. */
          const found = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SystemUser);
          setMemberships(found);

          /* Las membresias secundarias (invitaciones a otra empresa) se reindexan
             a uid__companyId: es la clave que las reglas de Firestore reconocen. */
          const uid = firebaseUser.uid;
          for (const m of found) {
            const expected = `${uid}__${m.companyId ?? ''}`;
            if (!m.companyId || m.id === uid || m.id === expected) continue;
            const { id: _old, ...data } = m;
            void _old;
            void setDoc(doc(db, COLLECTIONS.SYSTEM_USERS, expected), data, { merge: true })
              .then(() => deleteDoc(doc(db, COLLECTIONS.SYSTEM_USERS, m.id)))
              .catch(() => undefined);
          }

          const canOverride = found.some((m) => m.isPlatformAdmin) || isListedAdmin;
          /* Solo la empresa confirmada en el login; sin ella, el login pide el paso "Company".
             El admin de plataforma puede confirmar cualquier empresa. */
          const chosen = found.find((m) => m.companyId && m.companyId === companyOverride);
          const nextProfile = chosen ?? (canOverride ? found[0] : undefined);
          const nextCompany = chosen?.companyId ?? (canOverride ? companyOverride : '');

          if (getActiveCompanyId() !== nextCompany) setActiveCompanyId(nextCompany);
          setCompanyId(nextCompany);
          setProfile(nextProfile ?? null);
          setIsBootstrapAdmin(false);
          setProfileReady(true);
          return;
        }
        setMemberships([]);
        /* Admin de plataforma por email, sin membresia propia: usa la empresa confirmada. */
        const adminCompany = isListedAdmin ? companyOverride : '';
        if (getActiveCompanyId() !== adminCompany) setActiveCompanyId(adminCompany);
        setCompanyId(adminCompany);
        /* Sin perfil: si la coleccion esta vacia, es el primer usuario (bootstrap). */
        void getDocs(query(collection(db, COLLECTIONS.SYSTEM_USERS), limit(1)))
          .then((all) => setIsBootstrapAdmin(all.empty))
          .finally(() => setProfileReady(true));
      },
      () => setProfileReady(true),
    );
    return unsubscribe;
  }, [firebaseUser, overrideCompanyId, adminLookup]);

  /* Administradores agregados desde el Admin Panel (platform_admins/{email}). */
  useEffect(() => {
    const email = firebaseUser?.email?.toLowerCase();
    if (!email || isPlatformAdminEmail(email)) return;
    let cancelled = false;
    const lookup = async () => {
      const isAdmin = await isAddedPlatformAdmin(email);
      if (!cancelled) setAdminLookup({ email, isAdmin });
    };
    void lookup();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  /* Primer inicio de sesion: pasa de "Pending Invite" a "Active" */
  useEffect(() => {
    if (profile && profile.status === 'Pending Invite') {
      void updateDoc(doc(db, COLLECTIONS.SYSTEM_USERS, profile.id), { status: 'Active' }).catch(
        () => undefined,
      );
    }
  }, [profile]);

  /* Ficha de la empresa activa: nombre y estado de suscripcion, en tiempo real. */
  useEffect(() => {
    setCompany(null);
    if (!companyId) return;
    let lastStatus = '';
    const unsubscribe = onSnapshot(
      doc(db, COLLECTIONS.COMPANIES, companyId),
      (snap) => {
        const next = snap.exists() ? ({ id: snap.id, ...snap.data() } as Company) : null;
        /* Recien aprobada: se recarga para abrir las suscripciones que las reglas
           negaban mientras estaba pendiente (Configurator, catalogos...). */
        if (lastStatus === 'Pending' && next && next.status !== 'Pending') {
          window.location.reload();
          return;
        }
        lastStatus = next?.status ?? '';
        /* En prueba gratuita, los formularios admiten un numero limitado de registros. */
        setTrialLimitsActive(!!next && isOnFreeTrial(next));
        setCompany(next);
      },
      () => setCompany(null),
    );
    return () => {
      unsubscribe();
      setTrialLimitsActive(false);
    };
  }, [companyId]);

  /* Rol del perfil (en tiempo real) */
  useEffect(() => {
    setRole(null);
    if (!profile?.roleId) {
      setRoleReady(true);
      return;
    }
    setRoleReady(false);
    const unsubscribe = onSnapshot(
      doc(db, tenantPath(COLLECTIONS.ROLES), profile.roleId),
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
      doc(db, tenantPath(COLLECTIONS.ROLES), viewAsProfile.roleId),
      (snap) => setViewAsRole(snap.exists() ? ({ id: snap.id, ...snap.data() } as AppRole) : null),
      () => setViewAsRole(null),
    );
  }, [viewAsProfile?.roleId]);

  const currentEmail = firebaseUser?.email?.toLowerCase() ?? '';
  /* Los duenos fijos no se buscan; los demas esperan la respuesta de platform_admins. */
  const adminLookupReady = !currentEmail || isPlatformAdminEmail(currentEmail) || adminLookup.email === currentEmail;
  const loading = !authReady || (!!firebaseUser && (!profileReady || !roleReady || !adminLookupReady));
  const consoleMode = overrideCompanyId === PLATFORM_CONSOLE_ID;

  const value = useMemo<AuthContextValue>(() => {
    /* Dueno del SaaS: por flag en su perfil o por email (llave maestra). */
    /* Por email (dueno fijo o agregado) solo cuenta con el email verificado, como en las reglas. */
    const listedByEmail =
      isPlatformAdminEmail(currentEmail) || (adminLookup.email === currentEmail && adminLookup.isAdmin);
    const emailVerified = !!firebaseUser?.emailVerified;
    const platformAdmin =
      bypass || isBootstrapAdmin || !!profile?.isPlatformAdmin || (listedByEmail && emailVerified);
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
      /* Admin de la plataforma: acceso total en cualquier empresa que abra,
         incluso antes de que exista un rol dentro de esa empresa. */
      if (platformAdmin) return true;
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
      companyId,
      company,
      memberships,
      /* Sin empresa confirmada se queda en el login (aunque el perfil aun cargue);
         con una confirmada que ya no es valida, vuelve al login al terminar de cargar. */
      needsCompanyChoice:
        !!firebaseUser && !bypass && !consoleMode && (!overrideCompanyId || (!loading && !companyId)),
      chooseCompany: (next: string) => {
        localStorage.setItem(COMPANY_OVERRIDE_KEY, next);
        setOverrideCompanyId(next);
        setActiveCompanyId(next);
      },
      chooseConsole: () => {
        localStorage.setItem(COMPANY_OVERRIDE_KEY, PLATFORM_CONSOLE_ID);
        setOverrideCompanyId(PLATFORM_CONSOLE_ID);
        setActiveCompanyId('');
      },
      isPlatformAdmin: platformAdmin,
      platformNeedsVerification: listedByEmail && !emailVerified && !platformAdmin,
      consoleMode,
      loading: bypass ? false : loading,
      isBootstrapAdmin,
      bypass,
      enterAsGuest: () => {
        sessionStorage.setItem('berry-dev-bypass', '1');
        setBypass(true);
      },
      can,
      canAdmin: (cap) => {
        if (bypass || isBootstrapAdmin || platformAdmin) return true;
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
        /* Cada inicio de sesion confirma la empresa, aunque haya quedado una guardada. */
        localStorage.removeItem(COMPANY_OVERRIDE_KEY);
        setOverrideCompanyId('');
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      logout: async () => {
        sessionStorage.removeItem('berry-dev-bypass');
        sessionStorage.removeItem('berry-view-as');
        /* La proxima entrada vuelve a confirmar la empresa en el login. */
        localStorage.removeItem(COMPANY_OVERRIDE_KEY);
        setOverrideCompanyId('');
        setViewAsUserId(null);
        setBypass(false);
        await signOut(auth);
      },
      resetPassword: async (email) => {
        await resendPasswordReset(email.trim());
      },
    };
  }, [firebaseUser, profile, role, loading, isBootstrapAdmin, bypass, companyId, company, memberships, overrideCompanyId, consoleMode, currentEmail, adminLookup, viewAsUserId, viewAsProfile, viewAsRole]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
