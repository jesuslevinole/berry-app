/**
 * Envio de correos con Resend a traves del Worker de Cloudflare (/api/send-email).
 * El navegador nunca ve la API key: manda el ID token de Firebase del usuario y el
 * Worker lo verifica antes de enviar.
 */
import { auth } from '../firebase/config';
import { getActiveCompanyId } from './tenant';

export interface EmailAttachment {
  filename: string;
  /** Contenido en base64 (sin el prefijo data:). */
  content: string;
}

export interface SendEmailInput {
  to: string[];
  cc?: string[];
  /** Cliente del documento: el servidor permite tambien sus correos (Sales / Accounting Email). */
  customerId?: string;
  /** Warehouse (Locations) de la orden: el servidor permite tambien su correo. */
  warehouseId?: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "a@x.com, b@y.com; c@z.com" -> ["a@x.com", "b@y.com", "c@z.com"] */
export const parseEmails = (value: unknown): string[] =>
  (Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '')
    .split(/[,;\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);

export const isValidEmail = (value: string): boolean => EMAIL_RE.test(value);

/** Texto plano del mensaje -> HTML sencillo (parrafos y saltos de linea). */
export const textToHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br />')}</p>`)
    .join('');

export interface RecipientResult {
  email: string;
  id?: string;
  error?: string;
}

/** Token de la sesion para las llamadas al Worker. */
async function sessionToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session expired. Sign in again.');
  return user.getIdToken();
}

/**
 * Envia el correo: el servidor manda una copia individual a cada destinatario y
 * devuelve el resultado de cada uno (enviado con su id, o el motivo del rechazo).
 */
export async function sendEmail(input: SendEmailInput): Promise<RecipientResult[]> {
  const token = await sessionToken();

  let response: Response;
  try {
    response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      /* La empresa activa: el servidor valida los destinatarios contra su Email Settings. */
      body: JSON.stringify({ ...input, companyId: getActiveCompanyId() }),
    });
  } catch {
    throw new Error('Could not reach the email service. Check your connection.');
  }

  const data = (await response.json().catch(() => ({}))) as { results?: RecipientResult[]; error?: string };
  if (!response.ok) throw new Error(data.error || `The email could not be sent (${response.status}).`);
  return data.results ?? [];
}

export type DeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'delivery_delayed'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'opened'
  | 'clicked'
  | 'unknown';

/** Estado real de entrega en Resend de cada correo enviado (por id). */
export async function checkDeliveryStatus(ids: string[]): Promise<Record<string, DeliveryStatus>> {
  const token = await sessionToken();
  const response = await fetch('/api/email-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ids }),
  });
  const data = (await response.json().catch(() => ({}))) as { statuses?: Record<string, { status: string }>; error?: string };
  if (!response.ok) throw new Error(data.error || 'Could not check the delivery status.');
  const out: Record<string, DeliveryStatus> = {};
  for (const [id, value] of Object.entries(data.statuses ?? {})) out[id] = (value.status as DeliveryStatus) || 'unknown';
  return out;
}
