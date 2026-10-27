/**
 * Cliente minimo de la API de Square (REST). El token vive en el secret SQUARE_ACCESS_TOKEN y el
 * ambiente en la var SQUARE_ENV ("sandbox" o "production").
 */

/* Version de la API con la que se escribio este codigo (Square la exige en cada llamada). */
export const SQUARE_VERSION = '2025-09-24';

const BASE_URLS = {
  sandbox: 'https://connect.squareupsandbox.com/v2',
  production: 'https://connect.squareup.com/v2',
} as const;

export interface Money {
  amount: number;
  currency: string;
}

export interface SquareSubscription {
  id: string;
  status?: 'PENDING' | 'ACTIVE' | 'CANCELED' | 'DEACTIVATED' | 'PAUSED' | 'COMPLETED';
  plan_variation_id?: string;
  customer_id?: string;
  card_id?: string;
  start_date?: string;
  canceled_date?: string;
  charged_through_date?: string;
}

export interface SquareCard {
  id: string;
  card_brand?: string;
  last_4?: string;
  exp_month?: number;
  exp_year?: number;
}

interface SquareErrorBody {
  errors?: { category?: string; code?: string; detail?: string; field?: string }[];
}

/** Error de Square con un mensaje que se puede mostrar al usuario. */
export class SquareError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, body: SquareErrorBody) {
    const first = body.errors?.[0];
    super(first?.detail || `Square error (${status})`);
    this.status = status;
    this.code = first?.code ?? '';
  }
}

export class SquareClient {
  private readonly token: string;
  private readonly base: string;

  constructor(token: string, env: string) {
    if (!token) throw new Error('SQUARE_ACCESS_TOKEN is not configured');
    this.token = token;
    this.base = env === 'production' ? BASE_URLS.production : BASE_URLS.sandbox;
  }

  async call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Square-Version': SQUARE_VERSION,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & SquareErrorBody;
    if (!res.ok || data.errors?.length) throw new SquareError(res.status, data);
    return data;
  }
}

/** Dolares a centavos (Square trabaja en la unidad minima de la moneda). */
export const toCents = (dollars: number): number => Math.round(dollars * 100);

/* ---------------- Firma de los webhooks ---------------- */

const bytesToB64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
};

/* Comparacion en tiempo constante (no revela cuantos caracteres coinciden). */
const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/**
 * Square firma cada aviso con HMAC-SHA256 (llave = Signature Key del webhook) sobre la URL del
 * webhook tal como se registro + el cuerpo crudo, en base64 (header x-square-hmacsha256-signature).
 */
export async function isValidSquareSignature(
  signatureKey: string,
  notificationUrl: string,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  if (!signatureKey || !notificationUrl || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signatureKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(notificationUrl + rawBody));
  return safeEqual(bytesToB64(new Uint8Array(mac)), signature);
}
