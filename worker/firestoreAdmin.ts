/**
 * Firestore con la cuenta de servicio (secret FIREBASE_SERVICE_ACCOUNT): lo usa el cobro con
 * Square para escribir lo que ningun usuario puede escribir (pagos, fin del periodo pagado).
 * Salta las reglas de seguridad: solo se usa en rutas que ya verificaron quien llama
 * (usuario de Firebase o firma del webhook de Square).
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

export type FirestoreData = Record<string, unknown>;

interface FirestoreValue {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  stringValue?: string;
  timestampValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

const SCOPE = 'https://www.googleapis.com/auth/datastore';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let tokenCache: { token: string; expires: number; email: string } | null = null;

const parseServiceAccount = (raw: string): ServiceAccount => {
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing client_email, private_key or project_id');
  }
  return parsed as ServiceAccount;
};

const bytesToB64url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const textToB64url = (text: string): string => bytesToB64url(new TextEncoder().encode(text));

const pemToBytes = (pem: string): Uint8Array<ArrayBuffer> => {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

/** Token OAuth de la cuenta de servicio (JWT firmado RS256, vigente ~1 hora, en cache). */
async function accessToken(account: ServiceAccount): Promise<string> {
  if (tokenCache && tokenCache.email === account.client_email && tokenCache.expires > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = textToB64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = textToB64url(
    JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${bytesToB64url(new Uint8Array(signature))}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google token error (${res.status}${data.error ? `: ${data.error}` : ''})`);
  tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000, email: account.client_email };
  return data.access_token;
}

/* ---------------- Conversion JS <-> formato REST de Firestore ---------------- */

const toValue = (value: unknown): FirestoreValue => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (typeof value === 'object') return { mapValue: { fields: toFields(value as FirestoreData) } };
  return { stringValue: String(value) };
};

const toFields = (data: FirestoreData): Record<string, FirestoreValue> =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)]));

const fromValue = (value: FirestoreValue): unknown => {
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(fromValue);
  if ('mapValue' in value) return fromFields(value.mapValue?.fields ?? {});
  return null;
};

const fromFields = (fields: Record<string, FirestoreValue>): FirestoreData =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromValue(v)]));

/* Nombres de campo para el updateMask: los que no son identificadores simples van entre `backticks`. */
const fieldPath = (name: string): string => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `\`${name.replace(/`/g, '\\`')}\``);

const SAFE_SEGMENT_RE = /^[A-Za-z0-9_@.\-]{1,200}$/;

/** Cliente de Firestore con permisos de administrador para una ruta de documentos. */
export class FirestoreAdmin {
  private readonly account: ServiceAccount;
  private readonly root: string;

  constructor(serviceAccountJson: string) {
    this.account = parseServiceAccount(serviceAccountJson);
    this.root = `projects/${this.account.project_id}/databases/(default)/documents`;
  }

  /** Valida cada segmento de la ruta (nada de "/" sueltos ni caracteres raros que vengan del navegador). */
  private docName(path: string): string {
    const segments = path.split('/');
    const invalid = (s: string): boolean => !SAFE_SEGMENT_RE.test(s) || s === '.' || s === '..';
    if (segments.length % 2 !== 0 || segments.some(invalid)) throw new Error(`Invalid document path: ${path}`);
    return `${this.root}/${path}`;
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
    const token = await accessToken(this.account);
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, data };
  }

  /** Lee un documento; null si no existe. */
  async get(path: string): Promise<FirestoreData | null> {
    const { status, data } = await this.request<FirestoreDocument & { error?: { message?: string } }>(
      `https://firestore.googleapis.com/v1/${this.docName(path)}`,
    );
    if (status === 404) return null;
    if (status !== 200) throw new Error(`Firestore get ${status}: ${data.error?.message ?? ''}`);
    return fromFields(data.fields ?? {});
  }

  /**
   * Actualiza solo los campos dados (o crea el documento si no existe) y pone `updatedAt` con la
   * hora del servidor, como hace el app: asi el cambio le llega a los equipos que sincronizan por cambios.
   */
  async merge(path: string, data: FirestoreData, options: { createdAt?: boolean } = {}): Promise<void> {
    const name = this.docName(path);
    const transforms = [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }];
    if (options.createdAt) transforms.push({ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' });
    const body = {
      writes: [
        {
          update: { name, fields: toFields(data) },
          updateMask: { fieldPaths: Object.keys(data).filter((k) => data[k] !== undefined).map(fieldPath) },
          updateTransforms: transforms,
        },
      ],
    };
    const { status, data: result } = await this.request<{ error?: { message?: string } }>(
      `https://firestore.googleapis.com/v1/${this.root}:commit`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (status !== 200) throw new Error(`Firestore commit ${status}: ${result.error?.message ?? ''}`);
  }

  /** Documentos de una coleccion de la raiz donde `field == value` (maximo `limit`). */
  async findByField(collectionId: string, field: string, value: string, limit = 5): Promise<{ id: string; data: FirestoreData }[]> {
    if (!SAFE_SEGMENT_RE.test(collectionId)) throw new Error('Invalid collection');
    const body = {
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath: fieldPath(field) }, op: 'EQUAL', value: toValue(value) } },
        limit,
      },
    };
    const { status, data } = await this.request<{ document?: FirestoreDocument }[] | { error?: { message?: string } }>(
      `https://firestore.googleapis.com/v1/${this.root}:runQuery`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (status !== 200 || !Array.isArray(data)) {
      throw new Error(`Firestore query ${status}: ${(data as { error?: { message?: string } }).error?.message ?? ''}`);
    }
    return data
      .filter((row): row is { document: FirestoreDocument } => !!row.document)
      .map((row) => ({ id: row.document.name.split('/').pop() ?? '', data: fromFields(row.document.fields ?? {}) }));
  }

  /** Todos los documentos de una coleccion de la raiz (para colecciones chicas como platform_plans). */
  async list(collectionId: string): Promise<{ id: string; data: FirestoreData }[]> {
    if (!SAFE_SEGMENT_RE.test(collectionId)) throw new Error('Invalid collection');
    const { status, data } = await this.request<{ documents?: FirestoreDocument[]; error?: { message?: string } }>(
      `https://firestore.googleapis.com/v1/${this.root}/${collectionId}?pageSize=300`,
    );
    if (status !== 200) throw new Error(`Firestore list ${status}: ${data.error?.message ?? ''}`);
    return (data.documents ?? []).map((d) => ({ id: d.name.split('/').pop() ?? '', data: fromFields(d.fields ?? {}) }));
  }
}
