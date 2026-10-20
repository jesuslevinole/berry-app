/**
 * Acciones del admin de plataforma sobre la suscripcion de una empresa
 * (Companies y panel Admin). Mientras no haya pasarela de pago, los pagos se
 * registran a mano; con Stripe, el Worker hara lo mismo desde el webhook.
 */
import { createDocument, updateDocument } from './firestore';
import { updateSystemUser } from './systemUsersService';
import { newCompanyBilling, nextPaidThrough } from './billingService';
import { COLLECTIONS, type Company, type CompanyPayment, type PlatformPayment, type SystemUser } from '../types/models';

/**
 * Aprueba una empresa registrada sola: activa a su dueno en espera y despues la
 * empresa, con la prueba gratuita desde hoy. El dueno va primero: al cambiar la
 * ficha, su app se recarga y ya debe poder entrar.
 */
export const approveCompany = async (company: Company, users: SystemUser[]): Promise<void> => {
  const waitingOwners = users.filter((u) => u.companyId === company.id && u.status === 'Pending Approval');
  for (const owner of waitingOwners) await updateSystemUser(owner.id, { status: 'Active' });
  await updateDocument<Company>(COLLECTIONS.COMPANIES, company.id, { status: 'Active', ...newCompanyBilling() });
};

/**
 * Registra un pago: extiende el acceso de la empresa y lo guarda en el historial
 * de la plataforma (platform_payments), que alimenta el dashboard de ingresos.
 * Devuelve el nuevo "paid through".
 */
export const recordCompanyPayment = async (
  company: Company,
  payment: CompanyPayment,
  recordedBy: string,
): Promise<string> => {
  const paidThrough = nextPaidThrough(company, payment.periods);
  await updateDocument<Company>(COLLECTIONS.COMPANIES, company.id, {
    paidThrough,
    lastPaymentAt: payment.paidOn,
    lastPaymentAmount: payment.amount,
  });
  await createDocument<PlatformPayment>(COLLECTIONS.PLATFORM_PAYMENTS, {
    companyId: company.id,
    companyName: company.name,
    amount: payment.amount,
    periods: payment.periods,
    paidOn: payment.paidOn,
    paidThrough,
    recordedBy,
  });
  return paidThrough;
};

/** "No payment required": via libre en el app, nunca se cobra ni se bloquea. */
export const setCompanyExempt = async (company: Company, exempt: boolean): Promise<void> => {
  await updateDocument<Company>(COLLECTIONS.COMPANIES, company.id, { exempt });
};

/** Suspende (quita el acceso de inmediato) o reactiva una empresa. */
export const setCompanySuspended = async (company: Company, suspended: boolean): Promise<void> => {
  await updateDocument<Company>(COLLECTIONS.COMPANIES, company.id, { status: suspended ? 'Suspended' : 'Active' });
};
