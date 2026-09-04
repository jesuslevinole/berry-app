/** Formato de dinero igual al de la app de referencia: $12.960,00 */
export const fmtMoney = (n?: number | null): string =>
  `$${(n ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** yyyy-mm-dd -> d/m/yyyy (como en las capturas). */
export const fmtDate = (iso?: string): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
};

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const toNumber = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Milisegundos de un createdAt de Firestore (Timestamp, string ISO o vacio). */
const createdMillis = (value: unknown): number => {
  if (!value) return 0;
  if (typeof value === 'string') return new Date(value).getTime() || 0;
  const t = value as { seconds?: number; toMillis?: () => number };
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  return 0;
};

/** Comparador: registro mas reciente primero (por createdAt). */
export const byNewest = <T extends { createdAt?: unknown }>(a: T, b: T): number =>
  createdMillis(b.createdAt) - createdMillis(a.createdAt);

/**
 * Formato de telefono de Estados Unidos: (XXX) XXX-XXXX.
 * Va formateando conforme se escribe y admite el prefijo pais "1".
 * Se queda con los digitos y arma la mascara segun cuantos haya.
 */
export const formatUsPhone = (raw: string): string => {
  let digits = (raw ?? '').replace(/\D/g, '');
  // Quita el 1 de pais si viene con 11 digitos (1 + 10).
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  const len = digits.length;
  if (len === 0) return '';
  if (len < 4) return `(${digits}`;
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};
