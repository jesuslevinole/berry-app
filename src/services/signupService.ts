import { createUserWithEmailAndPassword } from 'firebase/auth';
import { addDoc, collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { pathForCompany } from './tenant';
import { newCompanyBilling } from './billingService';
import { MODULE_DEFS } from '../config/modules';
import { ADMIN_CAPABILITIES, COLLECTIONS, type AdminPerms, type ModulePermission } from '../types/models';

export interface SignupData {
  companyName: string;
  companyCode: string;
  /** Logo opcional en data URL (se guarda en la ficha de la empresa). */
  logo: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

/** Rol de dueno: todos los modulos y capacidades del configurador. */
function ownerPermissions(): ModulePermission[] {
  return MODULE_DEFS
    /* Companies es de la plataforma, no de las empresas cliente. */
    .filter((m) => m.id !== 'companies')
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
 * 2. Crea la empresa con su prueba gratuita de 7 dias.
 * 3. Crea el rol de dueno DENTRO de esa empresa y le asigna al usuario.
 * 4. Guarda nombre y logo en la ficha de la empresa.
 *
 * Todo queda bajo companies/{id}, asi que la empresa nace aislada del resto.
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
    status: 'Active',
    billingEmail: email,
    exempt: false,
    ...newCompanyBilling(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const companyId = companyRef.id;

  /* 3. Perfil del dueno: primero sin rol, para que las reglas ya lo reconozcan
        como miembro de la empresa y permitan crear el rol dentro de ella. */
  await setDoc(doc(db, COLLECTIONS.SYSTEM_USERS, uid), {
    firstName: data.firstName.trim(),
    lastName: data.lastName.trim(),
    email,
    companyId,
    roleId: '',
    status: 'Active',
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

  /* 4. Ficha de la empresa (nombre y logo que ve la app). */
  await setDoc(
    doc(db, pathForCompany(companyId, COLLECTIONS.COMPANY), 'company'),
    {
      name: data.companyName.trim(),
      address: '',
      cityStateZip: '',
      phone: '',
      email,
      logo: data.logo,
      banks: [],
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return { companyId };
}
