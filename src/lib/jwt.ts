import { createHmac } from 'crypto';
import { env } from '../config/env';

export function signPayload(payload: object, secret?: string, expiresInSec = 3600): string {
  const key = secret ?? env.MAGIC_LINK_SECRET ?? 'dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const body = Buffer.from(JSON.stringify({ ...payload, exp, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const sig = createHmac('sha256', key).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyPayload<T = Record<string, unknown>>(token: string, secret?: string): T | null {
  try {
    const key = secret ?? env.MAGIC_LINK_SECRET ?? 'dev-secret';
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const expected = createHmac('sha256', key).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as T;
  } catch {
    return null;
  }
}
