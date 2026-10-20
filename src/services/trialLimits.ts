/**
 * Reglas de la prueba gratuita (las mismas que se le informan a la empresa al
 * registrarse): dias de prueba, registros por formulario y dias de bloqueo antes
 * de borrar todo. La prueba empieza cuando la plataforma aprueba la empresa.
 */
import { COLLECTIONS } from '../types/models';

export { TRIAL_DAYS, TRIAL_GRACE_DAYS } from './billingService';

/** Registros que se pueden crear por formulario durante la prueba. */
export const TRIAL_RECORD_LIMIT = 10;

/**
 * Formularios principales con limite. Las lineas de una orden, los pagos y la
 * configuracion (correo, roles, ajustes) no cuentan.
 */
export const TRIAL_LIMITED_COLLECTIONS = new Set<string>([
  COLLECTIONS.PURCHASE_ORDER,
  COLLECTIONS.SALES_ORDER,
  COLLECTIONS.EXPENSES,
  COLLECTIONS.CUSTOMER,
  COLLECTIONS.USERS,
  COLLECTIONS.CATEGORY_BILL,
  COLLECTIONS.GROWER,
  COLLECTIONS.CARRIER,
  COLLECTIONS.LOCATIONS,
  COLLECTIONS.COMMODITIES,
  COLLECTIONS.SUPPLIERS,
  COLLECTIONS.SHIPVIA,
  COLLECTIONS.TERMSHIPPING,
  COLLECTIONS.PAYMENT_METHOD,
  COLLECTIONS.PAYMENTTERM,
  COLLECTIONS.CHECKS,
  COLLECTIONS.CHECK_ACCOUNTS,
]);

/** Evento del navegador que avisa al app que se llego al limite (lo muestra TrialLimitNotice). */
export const TRIAL_LIMIT_EVENT = 'berry:trial-limit';

export class TrialLimitError extends Error {
  constructor() {
    super(`Free trial limit reached: up to ${TRIAL_RECORD_LIMIT} records per form. Subscribe to keep adding records.`);
    this.name = 'TrialLimitError';
  }
}

/* La empresa activa esta en prueba: lo fija AuthContext al leer su ficha. */
let trialLimitsActive = false;

export const setTrialLimitsActive = (active: boolean): void => {
  trialLimitsActive = active;
};

export const isTrialLimited = (colName: string): boolean => trialLimitsActive && TRIAL_LIMITED_COLLECTIONS.has(colName);
