/** Formato de dinero de Estados Unidos: $12,960.00 (coma de miles, punto decimal). */
export const fmtMoney = (n?: number | null): string => {
  const value = n ?? 0;
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `-$${abs}` : `$${abs}`;
};

/** Cantidades en formato de Estados Unidos: 12,960 (hasta 2 decimales). */
export const fmtNumber = (n?: number | null): string =>
  (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** yyyy-mm-dd -> m/d/yyyy (formato de Estados Unidos). */
export const fmtDate = (iso?: string): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
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
