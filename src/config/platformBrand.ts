/**
 * Marca de la plataforma (Integrated Results): landing page, login, registro y
 * Admin Panel. Dentro de una empresa manda la marca de esa empresa (useBrandTheme).
 */
import platformLogo from '../assets/integrated-results-logo.png';
import platformLogoWhite from '../assets/integrated-results-logo-white.png';

export const PLATFORM_BRAND = {
  name: 'Integrated Results',
  legalName: 'Integrated Results LLC',
  logo: platformLogo,
  /** Version blanca, para fondos oscuros (landing). */
  logoWhite: platformLogoWhite,
  website: 'https://www.itgresults.com',
  email: 'info@itgresults.com',
} as const;

/** Correo para pedir un demo (el sitio usa un formulario; aqui va directo al correo). */
export const DEMO_REQUEST_URL = `mailto:${PLATFORM_BRAND.email}?subject=${encodeURIComponent('Demo request')}`;
