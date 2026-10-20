/**
 * Nombre y logo de las empresas de un usuario, para el paso "Company" del login.
 * El nombre sale de la ficha global (companies/{id}) y el logo de Company Info
 * (companies/{id}/settings_company/company). Cada empresa se lee por separado:
 * si una falla (sin permiso), las demas se muestran igual.
 */
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { pathForCompany } from './tenant';
import { COLLECTIONS, type Company, type CompanyInfo, type CompanyBrand } from '../types/models';

const COMPANY_INFO_DOC_ID = 'company';

const getCompanyBrand = async (companyId: string): Promise<CompanyBrand> => {
  const brand: CompanyBrand = { companyId, name: '', logo: '' };
  try {
    const card = await getDoc(doc(db, COLLECTIONS.COMPANIES, companyId));
    brand.name = (card.data() as Company | undefined)?.name ?? '';
  } catch {
    /* Sin acceso a la ficha: se queda sin nombre. */
  }
  try {
    const info = await getDoc(doc(db, pathForCompany(companyId, COLLECTIONS.COMPANY), COMPANY_INFO_DOC_ID));
    const data = info.data() as Partial<CompanyInfo> | undefined;
    brand.name = data?.name || brand.name;
    brand.logo = data?.logo ?? '';
  } catch {
    /* Sin acceso a Company Info: se muestra solo el nombre. */
  }
  return brand;
};

export const getCompanyBrands = async (companyIds: string[]): Promise<Record<string, CompanyBrand>> => {
  const brands = await Promise.all([...new Set(companyIds.filter(Boolean))].map(getCompanyBrand));
  return Object.fromEntries(brands.map((brand) => [brand.companyId, brand]));
};

/** Todas las empresas de la plataforma (solo el admin de plataforma puede leerlas). */
export const listCompanyIds = async (): Promise<string[]> => {
  const snap = await getDocs(collection(db, COLLECTIONS.COMPANIES));
  return snap.docs.map((card) => card.id);
};
