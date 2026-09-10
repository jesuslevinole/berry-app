import type { Company } from '../types/models';

/** Dias de prueba gratuita que recibe toda empresa nueva. */
export const TRIAL_DAYS = 7;

/** Dias que cubre un pago registrado (mensualidad). */
export const PAID_PERIOD_DAYS = 30;

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
 * - Exempt: no se le cobra nunca (empresa fundadora).
 * - Suspended: dada de baja manualmente.
 * - Paid: tiene periodo pagado vigente.
 * - Trial: dentro de los dias de prueba.
 * - Past due / Trial ended: vencidas, la app se bloquea.
 */
export function billingInfoOf(company: Company): BillingInfo {
  if (company.exempt) {
    return { state: 'Exempt', daysLeft: null, active: true, label: 'Exempt' };
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
    return { state: 'Past due', daysLeft: paidLeft, active: false, label: `Past due \u2014 ${Math.abs(paidLeft)} days` };
  }
  if (trialLeft !== null) {
    return { state: 'Trial ended', daysLeft: trialLeft, active: false, label: `Trial ended \u2014 ${Math.abs(trialLeft)} days ago` };
  }
  return { state: 'Trial ended', daysLeft: null, active: false, label: 'No subscription' };
}

/** Valores de arranque para una empresa nueva: prueba gratuita de 7 dias. */
export function newCompanyBilling(): Pick<Company, 'trialStartsAt' | 'trialEndsAt'> {
  return { trialStartsAt: addDays(0), trialEndsAt: addDays(TRIAL_DAYS) };
}
