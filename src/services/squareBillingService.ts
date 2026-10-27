/**
 * Cobro con Square desde el app: todo pasa por el Worker (/api/billing/*), que tiene el token de
 * Square y es el unico que escribe pagos y suscripciones en Firestore (worker/billing.ts).
 */
import type { Company, PlatformPlan } from '../types/models';
import { addDays, daysUntil } from './billingService';
import { sessionToken } from './emailService';

export type BillingCycle = 'monthly' | 'annual';

/** Datos publicos para el formulario de tarjeta de Square. */
export interface SquareConfig {
  applicationId: string;
  locationId: string;
  environment: 'sandbox' | 'production';
}

export interface PlanSyncResult {
  planId: string;
  name: string;
  status: string;
}

interface WorkerError {
  error?: string;
}

async function callWorker<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = body === undefined
    ? { method: 'GET' }
    : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await sessionToken()}` },
        body: JSON.stringify(body),
      };
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const data = (await response.json().catch(() => ({}))) as T & WorkerError;
  if (!response.ok) throw new Error(data.error || `The server answered with an error (${response.status}).`);
  return data;
}

export const fetchSquareConfig = (): Promise<SquareConfig> => callWorker<SquareConfig>('/api/billing/config');

/** (Admin Panel) Crea en Square los planes mensual y anual de cada plan con precio. */
export const syncSquarePlans = async (): Promise<PlanSyncResult[]> =>
  (await callWorker<{ results: PlanSyncResult[] }>('/api/billing/sync-plans', {})).results;

export interface SubscribeInput {
  companyId: string;
  planId: string;
  cycle: BillingCycle;
  /** Token de un solo uso del formulario de tarjeta (no es la tarjeta). */
  sourceId: string;
}

export const subscribeCompany = (input: SubscribeInput): Promise<{ subscriptionStartsAt: string }> =>
  callWorker('/api/billing/subscribe', input);

export const cancelCompanySubscription = (companyId: string): Promise<{ subscriptionCanceledDate: string }> =>
  callWorker('/api/billing/cancel', { companyId });

/* ---------------- reglas que muestra la pantalla Billing ---------------- */

/** Planes que se pueden pagar en linea: con precio, sin texto especial ("Let's talk"). */
export const isPlanPayableOnline = (plan: PlatformPlan): boolean =>
  plan.active && !plan.customPriceLabel.trim() && plan.monthlyPrice >= 1;

/** Precio del ciclo en USD (el anual se cobra completo: 12 x el precio por mes anual). */
export const cyclePrice = (plan: PlatformPlan, cycle: BillingCycle): number =>
  cycle === 'annual' ? plan.annualMonthlyPrice * 12 : plan.monthlyPrice;

/**
 * Fecha del primer cobro, igual que la calcula el Worker: el dia despues de la prueba o de lo
 * ya pagado, nunca antes de hoy.
 */
export const firstChargeDate = (company: Company): string => {
  const candidates = [addDays(0)];
  if (company.trialEndsAt) candidates.push(addDays(1, company.trialEndsAt));
  if (company.paidThrough) candidates.push(addDays(1, company.paidThrough));
  return candidates.sort().pop() ?? addDays(0);
};

/** Suscripcion vigente (activa o por empezar) y sin cancelacion programada. */
export const hasLiveSubscription = (company: Company): boolean =>
  !!company.squareSubscriptionId &&
  (company.subscriptionStatus === 'ACTIVE' || company.subscriptionStatus === 'PENDING') &&
  !company.subscriptionCanceledDate;

/** Quien puede ver Billing: el dueno de la empresa o un admin de la plataforma; nunca una empresa exenta. */
export const canManageBilling = (company: Company | null, uid: string | undefined, isPlatformAdmin: boolean): boolean =>
  !!company && !company.exempt && (isPlatformAdmin || (!!uid && company.ownerUid === uid));

/** true si el ultimo cobro automatico fallo y no hubo un pago despues. */
export const hasFailedCharge = (company: Company): boolean => {
  if (!company.lastPaymentFailedAt) return false;
  return !company.lastPaymentAt || company.lastPaymentFailedAt > company.lastPaymentAt;
};

/** Dias que faltan para el primer cobro (0 = hoy). */
export const daysUntilFirstCharge = (company: Company): number => Math.max(daysUntil(firstChargeDate(company)) ?? 0, 0);
