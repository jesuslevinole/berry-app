import type { Company } from '../types/models';

/** Dias de prueba gratuita que recibe toda empresa nueva. */
export const TRIAL_DAYS = 7;

/** Dias que cubre un pago registrado (mensualidad). */
export const PAID_PERIOD_DAYS = 30;

/** Dias antes del corte en que el panel Admin la marca "por vencer". */
export const EXPIRING_SOON_DAYS = 7;

export type BillingState =
  | 'Exempt'
  | 'Trial'
  | 'Trial ended'
  | 'Paid'
  | 'Past due'
  | 'Suspended';

export interface BillingInfo {
  state: BillingState;
  /** Dias restantes de prueba o de periodo pagado (negativo = vencido). */
  daysLeft: number | null;
  /** true si la empresa puede usar la app. */
  active: boolean;
  /** Texto corto para la UI. */
  label: string;
}

const startOfToday = (): number => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

/** Dias entre hoy y una fecha ISO (positivo = futuro). */
export function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  const target = new Date(`${iso}T00:00:00`).getTime();
  if (Number.isNaN(target)) return null;
  return Math.round((target - startOfToday()) / 86400000);
}

/** Suma dias a una fecha ISO (o a hoy) y devuelve ISO yyyy-mm-dd. */
export function addDays(days: number, fromIso?: string): string {
  const base = fromIso ? new Date(`${fromIso}T00:00:00`) : new Date();
  base.setDate(base.getDate() + days);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
}

/**
 * Estado de cobro de una empresa, calculado en el momento:
 * - Exempt ("No payment required"): via libre, no se le cobra ni se le bloquea nunca.
 * - Suspended: dada de baja manualmente, se bloquea.
 * - Paid: tiene periodo pagado vigente.
 * - Trial: dentro de los dias de prueba.
 * - Past due / Trial ended: vencidas, la app se bloquea.
 *
 * Importante: una empresa SIN ningun dato de suscripcion (creada antes del
 * cobro o migrada desde el modelo de una sola empresa) NO se bloquea.
 * Bloquear por falta de datos dejaba fuera a empresas legitimas; en su lugar
 * se marca como "Subscription not set" para que la plataforma le asigne plan.
 */
export function billingInfoOf(company: Company): BillingInfo {
  if (company.exempt) {
    return { state: 'Exempt', daysLeft: null, active: true, label: 'No payment required' };
  }
  if (company.status === 'Suspended') {
    return { state: 'Suspended', daysLeft: null, active: false, label: 'Suspended' };
  }

  const paidLeft = daysUntil(company.paidThrough);
  if (paidLeft !== null && paidLeft >= 0) {
    return {
      state: 'Paid',
      daysLeft: paidLeft,
      active: true,
      label: paidLeft === 0 ? 'Paid \u2014 last day' : `Paid \u2014 ${paidLeft} days left`,
    };
  }

  const trialLeft = daysUntil(company.trialEndsAt);
  if (trialLeft !== null && trialLeft >= 0) {
    return {
      state: 'Trial',
      daysLeft: trialLeft,
      active: true,
      label: trialLeft === 0 ? 'Free trial \u2014 last day' : `Free trial \u2014 ${trialLeft} days left`,
    };
  }

  if (paidLeft !== null) {
    return {
      state: 'Past due',
      daysLeft: paidLeft,
      active: false,
      label: `Past due \u2014 ${Math.abs(paidLeft)} days`,
    };
  }
  if (trialLeft !== null) {
    return {
      state: 'Trial ended',
      daysLeft: trialLeft,
      active: false,
      label: `Trial ended \u2014 ${Math.abs(trialLeft)} days ago`,
    };
  }

  /* Sin fechas registradas: se deja trabajar y se avisa a la plataforma. */
  return { state: 'Trial', daysLeft: null, active: true, label: 'Subscription not set' };
}

/** Valores de arranque para una empresa nueva: prueba gratuita de 7 dias. */
export function newCompanyBilling(): Pick<Company, 'trialStartsAt' | 'trialEndsAt'> {
  return { trialStartsAt: addDays(0), trialEndsAt: addDays(TRIAL_DAYS) };
}

/** Grupo de una empresa en el panel Admin de la plataforma. */
export type SubscriptionGroup = 'pending' | 'active' | 'expiring' | 'expired' | 'suspended' | 'exempt' | 'noPlan';

export const subscriptionGroupOf = (company: Company): SubscriptionGroup => {
  if (company.status === 'Pending') return 'pending';
  const billing = billingInfoOf(company);
  if (billing.state === 'Exempt') return 'exempt';
  if (billing.state === 'Suspended') return 'suspended';
  if (!billing.active) return 'expired';
  if (billing.daysLeft === null) return 'noPlan';
  return billing.daysLeft <= EXPIRING_SOON_DAYS ? 'expiring' : 'active';
};

/** Ultimo dia con acceso: el periodo pagado manda sobre la prueba. */
export const accessEndsOf = (company: Company): string => company.paidThrough ?? company.trialEndsAt ?? '';

/**
 * Nuevo fin del periodo pagado al registrar un pago. Si todavia tiene dias pagados
 * se suman al final (no pierde lo que ya pago); si esta vencida, cuenta desde hoy.
 */
export const nextPaidThrough = (company: Company, periods: number): string => {
  const left = daysUntil(company.paidThrough);
  const from = left !== null && left >= 0 ? company.paidThrough : undefined;
  return addDays(PAID_PERIOD_DAYS * periods, from);
};
