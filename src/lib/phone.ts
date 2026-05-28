import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';

export function normalizePhone(raw: string, defaultCountry: 'US' | 'CA' = 'US'): string | null {
  try {
    if (!isValidPhoneNumber(raw, defaultCountry)) return null;
    const parsed = parsePhoneNumber(raw, defaultCountry);
    return parsed.format('E.164');
  } catch {
    return null;
  }
}

export function isValidPhone(raw: string, defaultCountry: 'US' | 'CA' = 'US'): boolean {
  try {
    return isValidPhoneNumber(raw, defaultCountry);
  } catch {
    return false;
  }
}
