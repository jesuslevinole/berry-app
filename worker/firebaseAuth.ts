/**
 * Verificacion del ID token de Firebase que manda el navegador: firma RS256 con las llaves
 * publicas de Google, proyecto, emisor y vigencia.
 */

export interface FirebaseClaims {
  aud: string;
  iss: string;
  sub: string;
  exp: number;
  iat: number;
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
}

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
export async function verifyFirebaseToken(token: string, projectId: string): Promise<FirebaseClaims> {
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
