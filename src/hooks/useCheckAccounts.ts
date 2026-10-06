import { useEffect, useMemo, useRef } from 'react';
import { useCollection } from './useCollection';
import { useCompany } from './useCompany';
import { setDocumentWithId } from '../services/firestore';
import { COLLECTIONS, type Check, type CheckAccount, type CompanyBank, type CompanyInfo } from '../types/models';

const norm = (v: string): string => v.trim().toLowerCase();

/** "Bank of America-1191": nombre del banco + ultimos 4 de la cuenta (como en AppSheet). */
export const bankLabel = (bank: CompanyBank): string =>
  `${bank.bankName}${bank.account ? `-${bank.account.slice(-4)}` : ''}`;

/** La cuenta en el formato que espera la impresion de cheques. */
export const accountAsCompany = (a: CheckAccount): CompanyInfo => ({
  id: a.id,
  name: a.NAME ?? '',
  address: a.ADDRESS ?? '',
  cityStateZip: a.CITY_STATE_ZIP ?? '',
  phone: a.PHONE ?? '',
  email: a.EMAIL ?? '',
  logo: a.LOGO ?? '',
  banks: a.BANKS ?? [],
});

/** Id fijo de la cuenta creada a partir de Company Info (idempotente). */
const SEED_ID = 'company';

/**
 * Cuentas del Checking Set-Up. Si todavia no hay ninguna, se crea una a partir de
 * Company Info (mismos bancos e ids), asi los cheques existentes siguen resolviendo su banco.
 */
export function useCheckAccounts() {
  const { data: accounts, loading } = useCollection<CheckAccount>(COLLECTIONS.CHECK_ACCOUNTS);
  const { company, loading: companyLoading } = useCompany();
  const seeded = useRef(false);

  useEffect(() => {
    if (loading || companyLoading || seeded.current || accounts.length > 0 || !company.name) return;
    seeded.current = true;
    void setDocumentWithId(COLLECTIONS.CHECK_ACCOUNTS, SEED_ID, {
      NAME: company.name,
      ADDRESS: company.address ?? '',
      CITY_STATE_ZIP: company.cityStateZip ?? '',
      PHONE: company.phone ?? '',
      EMAIL: company.email ?? '',
      LOGO: company.logo ?? '',
      BANKS: company.banks ?? [],
    });
  }, [loading, companyLoading, accounts.length, company]);

  const sorted = useMemo(() => [...accounts].sort((a, b) => (a.NAME ?? '').localeCompare(b.NAME ?? '')), [accounts]);

  /** Cuenta del cheque: por ID_ACCOUNT, o por nombre (cheques importados), o la unica que haya. */
  const accountOf = useMemo(() => {
    const byId = new Map(sorted.map((a) => [a.id, a]));
    const byName = new Map(sorted.map((a) => [norm(a.NAME ?? ''), a]));
    return (check: Pick<Check, 'ID_ACCOUNT' | 'ACCOUNT'>): CheckAccount | undefined =>
      (check.ID_ACCOUNT ? byId.get(check.ID_ACCOUNT) : undefined) ??
      (check.ACCOUNT ? (byId.get(check.ACCOUNT) ?? byName.get(norm(check.ACCOUNT))) : undefined) ??
      (sorted.length === 1 ? sorted[0] : undefined);
  }, [sorted]);

  /**
   * Banco de un cheque. Acepta el id del banco o, para cheques importados de AppSheet,
   * la etiqueta "Bank of America-1191", el numero de cuenta o el nombre del banco.
   */
  const bankOf = useMemo(
    () =>
      (account: CheckAccount | undefined, value?: string): CompanyBank | undefined => {
        if (!value) return undefined;
        const pool = account ? (account.BANKS ?? []) : sorted.flatMap((a) => a.BANKS ?? []);
        const v = norm(value);
        return (
          pool.find((b) => b.id === value) ??
          pool.find((b) => norm(bankLabel(b)) === v) ??
          pool.find((b) => !!b.account && norm(b.account) === v) ??
          pool.find((b) => norm(b.bankName) === v)
        );
      },
    [sorted],
  );

  return { accounts: sorted, loading, accountOf, bankOf };
}
