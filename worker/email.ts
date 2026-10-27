/**
 * Correos (Resend): POST /api/send-email y POST /api/email-status.
 *  - La API key de Resend vive como secret del Worker (nunca llega al navegador).
 *  - El remitente lo fija el servidor (MAIL_FROM); el usuario solo va como Reply-To.
 *  - Solo se envia a correos autorizados en Email Settings (CAT_EMAILRECIPIENTS) de la
 *    empresa del usuario, del cliente o del warehouse del documento. Se leen de Firestore
 *    CON EL TOKEN DEL USUARIO, asi las reglas garantizan que solo vea su propia empresa.
 *  - Limites de destinatarios y de tamano para evitar abuso.
 */
import type { Env } from './env';
import { verifyFirebaseToken, type FirebaseClaims } from './firebaseAuth';
import { json } from './http';

const MAX_RECIPIENTS = 15;
const MAX_ATTACHMENTS = 6;
/** ~7.5 MB en base64 (Resend admite hasta 40 MB por correo). */
const MAX_ATTACHMENT_CHARS = 30_000_000;
const MAX_HTML_CHARS = 200_000;
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/* ---------------- Destinatarios autorizados (Email Settings) ---------------- */

const COMPANY_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

interface FirestoreListResponse {
  documents?: { fields?: Record<string, { stringValue?: string; booleanValue?: boolean }> }[];
  nextPageToken?: string;
}

/** Correos activos de Email Settings de la empresa, leidos con los permisos del usuario. */
async function authorizedRecipients(projectId: string, companyId: string, idToken: string): Promise<Set<string>> {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/companies/${companyId}/CAT_EMAILRECIPIENTS`;
  const emails = new Set<string>();
  let pageToken = '';
  for (let page = 0; page < 10; page += 1) {
    const url = `${base}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json' } });
    if (res.status === 403 || res.status === 401) throw new Error('forbidden');
    if (!res.ok) {
      /* Se devuelve el motivo exacto de Google para poder diagnosticar. */
      const detail = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string } };
      const reason = [detail.error?.status, detail.error?.message].filter(Boolean).join(': ');
      throw new Error(`Firestore ${res.status}${reason ? ` — ${reason}` : ''}`);
    }
    const data = (await res.json()) as FirestoreListResponse;
    for (const doc of data.documents ?? []) {
      const email = doc.fields?.EMAIL?.stringValue?.trim().toLowerCase();
      const active = doc.fields?.ACTIVE?.booleanValue !== false;
      if (email && active) emails.add(email);
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return emails;
}

/** Correos del cliente (Sales Email y Accounting Email), leidos con los permisos del usuario. */
async function customerEmails(projectId: string, companyId: string, customerId: string, idToken: string): Promise<Set<string>> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/companies/${companyId}/BD_CUSTOMER/${encodeURIComponent(customerId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json' } });
  if (res.status === 404) return new Set();
  if (res.status === 403 || res.status === 401) throw new Error('forbidden');
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  type FieldValue = { stringValue?: string; arrayValue?: { values?: { stringValue?: string }[] } };
  const data = (await res.json()) as { fields?: Record<string, FieldValue> };
  /* Texto separado por comas (EnumList) o lista. */
  const text = (f?: FieldValue): string =>
    f?.stringValue ?? (f?.arrayValue?.values ?? []).map((v) => v.stringValue ?? '').join(',');
  const raw = `${text(data.fields?.ACCOUNTING_EMAIL_CUSTOMER)},${text(data.fields?.ACCOUNTING_EMAIL_TWO_CUSTOMER)}`;
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => EMAIL_RE.test(e)),
  );
}

/** Correo(s) del Warehouse (Catalogs > Locations), leidos con los permisos del usuario. */
async function warehouseEmails(projectId: string, companyId: string, locationId: string, idToken: string): Promise<Set<string>> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/companies/${companyId}/CAT_LOCATIONS/${encodeURIComponent(locationId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json' } });
  if (res.status === 404) return new Set();
  if (res.status === 403 || res.status === 401) throw new Error('forbidden');
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  const data = (await res.json()) as { fields?: Record<string, { stringValue?: string }> };
  return new Set(
    (data.fields?.EMAIL_LOCATIONS?.stringValue ?? '')
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => EMAIL_RE.test(e)),
  );
}

/* ---------------- /api/send-email ---------------- */

interface SendEmailBody {
  to?: unknown;
  cc?: unknown;
  subject?: unknown;
  html?: unknown;
  attachments?: unknown;
  companyId?: unknown;
  customerId?: unknown;
  warehouseId?: unknown;
}

const emailList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean) : [];

export async function handleSendEmail(request: Request, env: Env): Promise<Response> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !env.FIREBASE_PROJECT_ID) {
    return json({ error: 'Email is not configured on the server (RESEND_API_KEY, MAIL_FROM, FIREBASE_PROJECT_ID).' }, 500);
  }

  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return json({ error: 'Sign in to send emails.' }, 401);

  let claims: FirebaseClaims;
  try {
    claims = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
  } catch {
    return json({ error: 'Your session is not valid. Sign in again.' }, 401);
  }

  let body: SendEmailBody;
  try {
    body = (await request.json()) as SendEmailBody;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const to = emailList(body.to);
  const cc = emailList(body.cc);
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 200) : '';
  const html = typeof body.html === 'string' ? body.html : '';
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

  if (to.length === 0) return json({ error: 'Add at least one recipient.' }, 400);
  if (to.length + cc.length > MAX_RECIPIENTS) return json({ error: `Up to ${MAX_RECIPIENTS} recipients per email.` }, 400);
  const bad = [...to, ...cc].filter((e) => !EMAIL_RE.test(e));
  if (bad.length) return json({ error: `Invalid email address: ${bad.join(', ')}` }, 400);
  if (!subject) return json({ error: 'The subject is required.' }, 400);
  if (html.length > MAX_HTML_CHARS) return json({ error: 'The message is too long.' }, 400);
  if (attachments.length > MAX_ATTACHMENTS) return json({ error: `Up to ${MAX_ATTACHMENTS} attachments.` }, 400);

  /* Solo correos autorizados en Email Settings de la empresa del usuario. */
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(companyId)) return json({ error: 'No active company.' }, 400);
  let allowed: Set<string>;
  try {
    allowed = await authorizedRecipients(env.FIREBASE_PROJECT_ID, companyId, token);
    /* Ademas de Email Settings: los correos del cliente del documento (Catalogs > Customers). */
    const customerId = typeof body.customerId === 'string' ? body.customerId : '';
    if (customerId && COMPANY_ID_RE.test(customerId)) {
      for (const email of await customerEmails(env.FIREBASE_PROJECT_ID, companyId, customerId, token)) allowed.add(email);
    }
    /* Y el correo del Warehouse (Catalogs > Locations) de la orden. */
    const warehouseId = typeof body.warehouseId === 'string' ? body.warehouseId : '';
    if (warehouseId && COMPANY_ID_RE.test(warehouseId)) {
      for (const email of await warehouseEmails(env.FIREBASE_PROJECT_ID, companyId, warehouseId, token)) allowed.add(email);
    }
  } catch (e) {
    const message = (e as Error).message || 'unknown error';
    if (message === 'forbidden') return json({ error: 'You do not have access to this company.' }, 403);
    console.error('Email Settings check failed:', message);
    return json({ error: `Could not check the authorized recipients (${message}).` }, 502);
  }
  const notAllowed = [...to, ...cc].filter((e) => !allowed.has(e.toLowerCase()));
  if (notAllowed.length) {
    return json({ error: `Not in Email Settings, the customer's or the warehouse's emails: ${notAllowed.join(', ')}` }, 403);
  }

  let totalChars = 0;
  const cleanAttachments: { filename: string; content: string }[] = [];
  for (const a of attachments) {
    const item = a as { filename?: unknown; content?: unknown };
    if (typeof item.filename !== 'string' || typeof item.content !== 'string') {
      return json({ error: 'Invalid attachment.' }, 400);
    }
    totalChars += item.content.length;
    cleanAttachments.push({ filename: item.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120), content: item.content });
  }
  if (totalChars > MAX_ATTACHMENT_CHARS) return json({ error: 'The attachment is too large.' }, 413);

  /*
   * Un correo por destinatario: cada uno recibe su copia (no ven a los demas), un
   * correo rechazado no tumba a los otros y se sabe el resultado de cada direccion.
   */
  const recipients = [...new Set([...to, ...cc].map((e) => e.toLowerCase()))];
  const replyTo = claims.email && claims.email_verified !== false ? claims.email : undefined;
  const results: { email: string; id?: string; error?: string }[] = [];

  for (let index = 0; index < recipients.length; index += 1) {
    const email = recipients[index];
    /* Resend permite ~2 envios por segundo: se espacian para no chocar con el limite. */
    if (index > 0) await sleep(600);
    results.push(
      await sendOne(env, {
        from: env.MAIL_FROM,
        to: [email],
        reply_to: replyTo,
        subject,
        html,
        attachments: cleanAttachments.length ? cleanAttachments : undefined,
      }).then((r) => ({ email, ...r })),
    );
  }

  const sent = results.filter((r) => r.id).length;
  if (sent === 0) {
    return json({ error: results[0]?.error ?? 'The email provider rejected the message.', results }, 502);
  }
  return json({ results });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Envia un correo a Resend; si responde "demasiadas solicitudes", reintenta una vez. */
async function sendOne(env: Env, payload: Record<string, unknown>): Promise<{ id?: string; error?: string }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (res.ok && data.id) return { id: data.id };
    if (res.status === 429 && attempt === 0) {
      await sleep(1200);
      continue;
    }
    return { error: data.message ? `Email provider: ${data.message}` : `Email provider error (${res.status}).` };
  }
  return { error: 'Email provider is busy. Try again.' };
}

/* ---------------- /api/email-status ---------------- */

/** Estado real de entrega de cada correo enviado (delivered, bounced, etc.), segun Resend. */
export async function handleEmailStatus(request: Request, env: Env): Promise<Response> {
  if (!env.RESEND_API_KEY || !env.FIREBASE_PROJECT_ID) return json({ error: 'Email is not configured on the server.' }, 500);
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  try {
    await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
  } catch {
    return json({ error: 'Your session is not valid. Sign in again.' }, 401);
  }
  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const valid = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string' && /^[\w-]{8,64}$/.test(v)) : [];
  const ids = [...new Set(valid)].slice(0, 40);

  const statuses: Record<string, { status: string; to?: string[] }> = {};
  for (let index = 0; index < ids.length; index += 1) {
    if (index > 0) await sleep(550);
    const id = ids[index];
    const res = await fetch(`https://api.resend.com/emails/${id}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    const data = (await res.json().catch(() => ({}))) as { last_event?: string; to?: string[] };
    statuses[id] = res.ok ? { status: data.last_event ?? 'unknown', to: data.to } : { status: 'unknown' };
  }
  return json({ statuses });
}
