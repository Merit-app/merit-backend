const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.ca',
  'hotmail.com', 'hotmail.ca', 'outlook.com', 'live.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
]);

const BLOCKED_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com',
  '10minutemail.com', 'throwaway.email',
]);

export function extractEmailDomain(email: string): string | null {
  const parts = email.toLowerCase().trim().split('@');
  if (parts.length !== 2 || !parts[1]) return null;
  return parts[1];
}

export function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain.toLowerCase());
}

export function isBlockedDomain(domain: string): boolean {
  return BLOCKED_DOMAINS.has(domain.toLowerCase());
}

export function classifyDomainType(domain: string): 'personal' | 'blocked' | 'org_unverified' {
  const d = domain.toLowerCase();
  if (BLOCKED_DOMAINS.has(d)) return 'blocked';
  if (PERSONAL_DOMAINS.has(d)) return 'personal';
  return 'org_unverified';
}
