import { useEffect, useState } from 'react';
import { addDays } from '../services/billingService';

/** Cada cuanto se revisa si ya cambio el dia. */
const CHECK_EVERY_MS = 10 * 60 * 1000;

/**
 * Fecha local de hoy (AAAA-MM-DD). Cambia sola al pasar la medianoche, asi lo que
 * vence "hoy" (bloqueo por suscripcion, panel Admin) se recalcula sin recargar.
 */
export const useToday = (): string => {
  const [today, setToday] = useState(() => addDays(0));

  useEffect(() => {
    const timer = window.setInterval(() => setToday(addDays(0)), CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  return today;
};
