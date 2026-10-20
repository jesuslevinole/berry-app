/**
 * Color de marca por empresa. Todo el app usa la paleta --green-50…950 de
 * styles/brand.css; aqui se genera esa misma escala a partir de UN color (el tono
 * 600) y se aplica sobre :root. Sin color guardado se quita y queda la de brand.css.
 */

/** Tono 600 de la paleta original (Berry Source). */
export const DEFAULT_BRAND_COLOR = '#265C46';

/** Colores sugeridos en Company Info (tono 600: oscuro para que el texto blanco se lea). */
export const BRAND_PRESETS: { label: string; color: string }[] = [
  { label: 'Forest', color: '#265C46' },
  { label: 'Navy', color: '#1F3A68' },
  { label: 'Ocean', color: '#155E75' },
  { label: 'Plum', color: '#5B2A6E' },
  { label: 'Berry', color: '#8A1C3A' },
  { label: 'Rust', color: '#9A3D12' },
  { label: 'Olive', color: '#4D5A1E' },
  { label: 'Graphite', color: '#2F3640' },
];

const HEX_RE = /^#?([0-9a-f]{6})$/i;

export const isBrandColor = (value: string | undefined | null): value is string => !!value && HEX_RE.test(value.trim());

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => {
  const clean = hex.trim().replace('#', '');
  return [0, 2, 4].map((offset) => parseInt(clean.slice(offset, offset + 2), 16)) as Rgb;
};

const toHex = (rgb: Rgb): string => `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;

/** Mezcla el color con blanco (amount > 0) o negro (amount < 0). */
const mix = (rgb: Rgb, amount: number): Rgb => {
  const target = amount > 0 ? 255 : 0;
  const weight = Math.abs(amount);
  return rgb.map((channel) => channel + (target - channel) * weight) as Rgb;
};

/* Proporciones sacadas de la paleta original: 50 casi blanco … 950 casi negro. */
const SHADES: { name: string; amount: number }[] = [
  { name: '--green-50', amount: 0.93 },
  { name: '--green-100', amount: 0.85 },
  { name: '--green-400', amount: 0.28 },
  { name: '--green-500', amount: 0.1 },
  { name: '--green-600', amount: 0 },
  { name: '--green-700', amount: -0.2 },
  { name: '--green-800', amount: -0.38 },
  { name: '--green-900', amount: -0.55 },
  { name: '--green-950', amount: -0.68 },
];

/** Escala completa (variable CSS -> color) a partir del tono 600. */
export const buildBrandPalette = (baseColor: string): Record<string, string> => {
  const rgb = toRgb(baseColor);
  return Object.fromEntries(SHADES.map(({ name, amount }) => [name, toHex(mix(rgb, amount))]));
};

/** Aplica el color de la empresa al app; sin color valido vuelve a la paleta de brand.css. */
export const applyBrandTheme = (baseColor?: string | null): void => {
  const rootStyle = document.documentElement.style;
  if (!isBrandColor(baseColor) || baseColor.toLowerCase() === DEFAULT_BRAND_COLOR.toLowerCase()) {
    SHADES.forEach(({ name }) => rootStyle.removeProperty(name));
    return;
  }
  Object.entries(buildBrandPalette(baseColor)).forEach(([name, color]) => rootStyle.setProperty(name, color));
};

/* ---- Ultima marca usada en este navegador (solo para pintar el login) ---- */

export interface CachedBrand {
  name: string;
  logo: string;
  color: string;
}

const CACHE_KEY = 'berry-last-brand';

export const readCachedBrand = (): CachedBrand | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedBrand) : null;
  } catch {
    return null;
  }
};

export const writeCachedBrand = (brand: CachedBrand): void => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(brand));
  } catch {
    /* Sin espacio (logo grande): se intenta sin el logo. */
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ...brand, logo: '' }));
    } catch {
      /* Sin localStorage: el login usa la marca por defecto. */
    }
  }
};
