import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { COLLECTIONS, type CompanyInfo } from '../types/models';

const COMPANY_DOC_ID = 'company';

const EMPTY: Omit<CompanyInfo, 'id'> = {
  name: '',
  address: '',
  cityStateZip: '',
  phone: '',
  email: '',
  logo: '',
  banks: [],
};

/** Documento unico de empresa (settings_company/company) en tiempo real. */
export function useCompany() {
  const [company, setCompany] = useState<CompanyInfo>({ id: COMPANY_DOC_ID, ...EMPTY });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(
      doc(db, COLLECTIONS.COMPANY, COMPANY_DOC_ID),
      (snap) => {
        setCompany(
          snap.exists()
            ? ({ id: snap.id, ...EMPTY, ...snap.data() } as CompanyInfo)
            : { id: COMPANY_DOC_ID, ...EMPTY },
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  const save = (data: Partial<Omit<CompanyInfo, 'id'>>) => {
    setDoc(doc(db, COLLECTIONS.COMPANY, COMPANY_DOC_ID), data, { merge: true }).catch(
      (error: Error) => alert(`Failed to save company info: ${error.message}`),
    );
  };

  return { company, loading, save };
}
