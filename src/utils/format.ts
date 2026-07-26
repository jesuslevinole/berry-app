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
