import { randomBytes, createHmac, timingSafeEqual } from 'crypto';

export function generateToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('hex');
}

export function generateUrlSafeToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export function hmacSign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function hmacVerify(data: string, signature: string, secret: string): boolean {
  const expected = hmacSign(data, secret);
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Constant-time comparison of a request-supplied secret against an expected
 * secret. Returns false if either value is missing or lengths differ, without
 * leaking timing information about how many characters matched.
 */
export function safeSecretEqual(provided: unknown, expected: string | undefined): boolean {
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Sanitize a free-text search term before embedding it in a PostgREST `.or()`
 * filter string. PostgREST treats `,` `(` `)` and `.` as structural characters,
 * so an unsanitized term can inject additional filter conditions. We strip those
 * plus the `*`/`%`/`\` wildcard/escape characters and cap the length.
 */
export function sanitizePostgrestSearch(input: string, maxLen = 100): string {
  return input
    .replace(/[,()*%\\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}
