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
