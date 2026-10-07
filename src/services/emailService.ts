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
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "a@x.com, b@y.com; c@z.com" -> ["a@x.com", "b@y.com", "c@z.com"] */
export const parseEmails = (value: string): string[] =>
  value
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

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session expired. Sign in again.');
  const token = await user.getIdToken();

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

  const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!response.ok) throw new Error(data.error || `The email could not be sent (${response.status}).`);
  return { id: data.id ?? '' };
}
