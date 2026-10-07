/**
 * Worker de Berry: sirve la app (dist/) y expone POST /api/send-email.
 *
 * Seguridad:
 *  - Solo usuarios autenticados: el navegador manda el ID token de Firebase y aqui se
 *    verifica la firma (RS256, llaves publicas de Google), el proyecto, el emisor y la vigencia.
 *  - La API key de Resend vive como secret del Worker (nunca llega al navegador).
 *  - El remitente lo fija el servidor (MAIL_FROM); el usuario solo va como Reply-To.
 *  - Solo se envia a correos autorizados en Email Settings (CAT_EMAILRECIPIENTS) de la
 *    empresa del usuario. La lista se lee de Firestore CON EL TOKEN DEL USUARIO, asi que las
 *    reglas de seguridad garantizan que solo vea la lista de su propia empresa.
 *  - Limites de destinatarios y de tamano para evitar abuso.
 */

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Secret: wrangler secret put RESEND_API_KEY */
  RESEND_API_KEY: string;
  /** Var: "Berry Source <noreply@tudominio.com>" (dominio verificado en Resend). */
  MAIL_FROM: string;
  /** Var: id del proyecto de Firebase (berry-app-7021e). */
  FIREBASE_PROJECT_ID: string;
}

interface FirebaseClaims {
  aud: string;
  iss: string;
  sub: string;
  exp: number;
  iat: number;
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
}

const MAX_RECIPIENTS = 10;
const MAX_ATTACHMENTS = 3;
/** ~7.5 MB en base64 (Resend admite hasta 40 MB por correo). */
const MAX_ATTACHMENT_CHARS = 10_000_000;
const MAX_HTML_CHARS = 200_000;
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/* ---------------- Verificacion del ID token de Firebase ---------------- */

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface Jwk extends JsonWebKey {
  kid: string;
}

/** Cache en memoria de las llaves publicas de Google (respeta su max-age). */
let jwksCache: { keys: Map<string, CryptoKey>; expires: number } | null = null;

async function googleKeys(): Promise<Map<string, CryptoKey>> {
  if (jwksCache && jwksCache.expires > Date.now()) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('Could not load Firebase public keys');
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const map = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    map.set(jwk.kid, key);
  }
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')?.[1] ?? 3600);
  jwksCache = { keys: map, expires: Date.now() + maxAge * 1000 };
  return map;
}

const b64urlToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const b64urlToJson = <T>(value: string): T => JSON.parse(new TextDecoder().decode(b64urlToBytes(value))) as T;

/** Devuelve los claims si el token es valido para este proyecto; si no, lanza error. */
async function verifyFirebaseToken(token: string, projectId: string): Promise<FirebaseClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = b64urlToJson<{ alg: string; kid: string }>(headerB64);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unexpected token algorithm');

  let keys = await googleKeys();
  if (!keys.has(header.kid)) {
    /* Google rota las llaves: si no esta, se recarga una vez. */
    jwksCache = null;
    keys = await googleKeys();
  }
  const key = keys.get(header.kid);
  if (!key) throw new Error('Unknown signing key');

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new Error('Invalid signature');

  const claims = b64urlToJson<FirebaseClaims>(payloadB64);
  const now = Math.floor(Date.now() / 1000);
  const skew = 300;
  if (claims.aud !== projectId) throw new Error('Wrong project');
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Wrong issuer');
  if (!claims.sub) throw new Error('Missing subject');
  if (claims.exp <= now - skew) throw new Error('Token expired');
  if (claims.iat > now + skew) throw new Error('Token issued in the future');
  if (claims.auth_time && claims.auth_time > now + skew) throw new Error('Invalid auth time');
  return claims;
}

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

/* ---------------- /api/send-email ---------------- */

interface SendEmailBody {
  to?: unknown;
  cc?: unknown;
  subject?: unknown;
  html?: unknown;
  attachments?: unknown;
  companyId?: unknown;
}

const emailList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean) : [];

async function handleSendEmail(request: Request, env: Env): Promise<Response> {
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
  } catch (e) {
    const message = (e as Error).message || 'unknown error';
    if (message === 'forbidden') return json({ error: 'You do not have access to this company.' }, 403);
    console.error('Email Settings check failed:', message);
    return json({ error: `Could not check the authorized recipients (${message}).` }, 502);
  }
  const notAllowed = [...to, ...cc].filter((e) => !allowed.has(e.toLowerCase()));
  if (notAllowed.length) {
    return json({ error: `Not in Email Settings: ${notAllowed.join(', ')}` }, 403);
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

  const resend = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to,
      cc: cc.length ? cc : undefined,
      /* Las respuestas del cliente llegan a quien envio el documento. */
      reply_to: claims.email && claims.email_verified !== false ? claims.email : undefined,
      subject,
      html,
      attachments: cleanAttachments.length ? cleanAttachments : undefined,
    }),
  });

  const result = (await resend.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!resend.ok) {
    return json({ error: result.message ? `Email provider: ${result.message}` : 'The email provider rejected the message.' }, 502);
  }
  return json({ id: result.id ?? '' });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/send-email') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      try {
        return await handleSendEmail(request, env);
      } catch {
        return json({ error: 'Unexpected error sending the email.' }, 500);
      }
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    /* Todo lo demas es la app (con fallback de SPA configurado en wrangler.jsonc). */
    return env.ASSETS.fetch(request);
  },
};
