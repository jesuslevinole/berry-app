/**
 * Ingresos de la plataforma (dashboard del Admin Panel), calculados desde el
 * historial de pagos (platform_payments). Funciones puras: no leen Firestore.
 */
import { billingInfoOf } from './billingService';
import type { Company, PlatformPayment } from '../types/models';

export interface MonthRevenue {
  /** AAAA-MM */
  key: string;
  /** "Oct" (eje) */
  label: string;
  /** "October 2026" (tooltip y tabla) */
  longLabel: string;
  amount: number;
  payments: number;
}

export interface CompanyRevenue {
  companyId: string;
  name: string;
  amount: number;
  payments: number;
}

const monthKeyOf = (iso: string): string => iso.slice(0, 7);

const monthDate = (key: string): Date => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1);
};

/** Los ultimos `count` meses hasta el de `today` (AAAA-MM-DD), del mas viejo al actual. */
const lastMonthKeys = (today: string, count: number): string[] => {
  const current = monthDate(monthKeyOf(today));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(current.getFullYear(), current.getMonth() - (count - 1 - index), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
};

/** Ingreso de cada uno de los ultimos meses (incluye los meses en cero). */
export const monthlyRevenue = (payments: PlatformPayment[], today: string, count = 12): MonthRevenue[] => {
  const totals = new Map<string, { amount: number; payments: number }>();
  for (const payment of payments) {
    if (!payment.paidOn) continue;
    const key = monthKeyOf(payment.paidOn);
    const total = totals.get(key) ?? { amount: 0, payments: 0 };
    total.amount += payment.amount ?? 0;
    total.payments += 1;
    totals.set(key, total);
  }
  return lastMonthKeys(today, count).map((key) => {
    const date = monthDate(key);
    return {
      key,
      label: date.toLocaleString('en-US', { month: 'short' }),
      longLabel: date.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      amount: totals.get(key)?.amount ?? 0,
      payments: totals.get(key)?.payments ?? 0,
    };
  });
};

/** Ingreso por empresa desde el mes `sinceKey` (AAAA-MM), de mayor a menor. */
export const revenueByCompany = (
  payments: PlatformPayment[],
  companies: Company[],
  sinceKey: string,
): CompanyRevenue[] => {
  const names = new Map(companies.map((company) => [company.id, company.name]));
  const totals = new Map<string, CompanyRevenue>();
  for (const payment of payments) {
    if (!payment.paidOn || monthKeyOf(payment.paidOn) < sinceKey) continue;
    const total = totals.get(payment.companyId) ?? {
      companyId: payment.companyId,
      /* El nombre actual manda (la empresa pudo cambiarlo despues del pago). */
      name: names.get(payment.companyId) ?? payment.companyName,
      amount: 0,
      payments: 0,
    };
    total.amount += payment.amount ?? 0;
    total.payments += 1;
    totals.set(payment.companyId, total);
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
};

/**
 * Ingreso mensual recurrente estimado (MRR): de cada empresa con periodo pagado
 * vigente, su ultimo pago dividido entre los meses que cubre.
 */
export const estimatedMrr = (companies: Company[], payments: PlatformPayment[]): number => {
  const latestByCompany = new Map<string, PlatformPayment>();
  for (const payment of payments) {
    const current = latestByCompany.get(payment.companyId);
    if (!current || payment.paidOn > current.paidOn) latestByCompany.set(payment.companyId, payment);
  }
  return companies.reduce((sum, company) => {
    if (billingInfoOf(company).state !== 'Paid') return sum;
    const latest = latestByCompany.get(company.id);
    if (latest) return sum + latest.amount / Math.max(1, latest.periods);
    return sum + (company.lastPaymentAmount ?? 0);
  }, 0);
};

/** Pagos mas recientes primero. */
export const sortByNewest = (payments: PlatformPayment[]): PlatformPayment[] =>
  [...payments].sort((a, b) => b.paidOn.localeCompare(a.paidOn));
