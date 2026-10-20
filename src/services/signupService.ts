import { createUserWithEmailAndPassword } from 'firebase/auth';
import { addDoc, collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { pathForCompany } from './tenant';
import { MODULE_DEFS } from '../config/modules';
import { ADMIN_CAPABILITIES, COLLECTIONS, type AdminPerms, type ModulePermission } from '../types/models';

export interface SignupData {
  companyName: string;
  companyCode: string;
  address: string;
  cityStateZip: string;
  phone: string;
  /** Logo opcional en data URL (se guarda en la ficha de la empresa). */
  logo: string;
  /** Color de marca (#RRGGBB); vacio = paleta original. */
  brandColor: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

/** Rol de dueno: todos los modulos y capacidades del configurador. */
function ownerPermissions(): ModulePermission[] {
  /* Companies y el Admin Panel no son modulos de empresa: viven en el Admin Panel. */
  return MODULE_DEFS
    .map((m) => ({
      module: m.id,
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canDocuments: true,
    }));
}

function ownerAdminPerms(): AdminPerms {
  const perms: AdminPerms = {};
  for (const cap of ADMIN_CAPABILITIES) perms[cap.id] = true;
  return perms;
}

/**
 * Alta de una empresa nueva hecha por el propio cliente:
 * 1. Crea su cuenta de acceso (Firebase Auth).
 * 2. Crea la empresa en estado 'Pending' (la plataforma la aprueba en Companies).
 * 3. Crea el perfil del dueno en espera ('Pending Approval') y su rol de dueno
 *    DENTRO de esa empresa.
 * 4. Guarda nombre, direccion, telefono, logo y color en la ficha de la empresa.
 *
 * Todo queda bajo companies/{id}, asi que la empresa nace aislada y vacia.
 * No se pone prueba gratuita: sin pagos, una prueba vencida la bloquearia sin
 * forma de pagar. La aprobacion es la puerta de entrada por ahora.
 * Escribe directo (no por services/firestore.ts): la empresa aun no es la activa
 * y el dueno pendiente no puede escribir el historial; cada documento lleva updatedAt.
 */
export async function signUpCompany(data: SignupData): Promise<{ companyId: string }> {
  const email = data.email.trim().toLowerCase();

  /* 1. Cuenta de acceso: deja la sesion iniciada, necesaria para escribir lo demas. */
  const cred = await createUserWithEmailAndPassword(auth, email, data.password);
  const uid = cred.user.uid;

  /* 2. Empresa + prueba gratuita. */
  const companyRef = await addDoc(collection(db, COLLECTIONS.COMPANIES), {
    name: data.companyName.trim(),
    code: data.companyCode.trim(),
    status: 'Pending',
    ownerUid: uid,
    billingEmail: email,
    exempt: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const companyId = companyRef.id;

  /* 3. Perfil del dueno en espera y sin rol; las reglas le dejan crear su rol
        y su ficha solo mientras la empresa esta pendiente. */
  await setDoc(doc(db, COLLECTIONS.SYSTEM_USERS, uid), {
    firstName: data.firstName.trim(),
    lastName: data.lastName.trim(),
    email,
    companyId,
    roleId: '',
    status: 'Pending Approval',
    isCompanyOwner: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const roleRef = await addDoc(collection(db, pathForCompany(companyId, COLLECTIONS.ROLES)), {
    name: 'Owner',
    description: 'Full access to every module of this company',
    permissions: ownerPermissions(),
    adminPerms: ownerAdminPerms(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await setDoc(doc(db, COLLECTIONS.SYSTEM_USERS, uid), { roleId: roleRef.id }, { merge: true });

  /* 4. Ficha de la empresa (marca y datos que ve la app y los documentos). */
  await setDoc(
    doc(db, pathForCompany(companyId, COLLECTIONS.COMPANY), 'company'),
    {
      name: data.companyName.trim(),
      address: data.address.trim(),
      cityStateZip: data.cityStateZip.trim(),
      phone: data.phone.trim(),
      email,
      logo: data.logo,
      brandColor: data.brandColor,
      banks: [],
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return { companyId };
}
