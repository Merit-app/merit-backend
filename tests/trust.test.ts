import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase before importing service
vi.mock('../src/config/supabase', () => {
  const chain: any = {};
  const methods = ['from','select','insert','update','upsert','delete','eq','neq','is','gte','lte',
    'lt','gt','in','or','order','limit','range','maybeSingle','single','rpc'];
  methods.forEach(m => { chain[m] = vi.fn(() => chain); });
  chain.then = undefined; // make it non-thenable so awaiting returns the chain
  const proxy: any = new Proxy({}, {
    get: (_t, p) => {
      if (p === 'then' || p === 'catch' || p === 'finally') return undefined;
      return (..._a: any[]) => Promise.resolve({ data: null, error: null, count: 0 });
    },
  });
  return { supabaseAdmin: proxy, SUPABASE_MODE: 'mock' };
});

vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/services/analytics.service', () => ({
  trackEvent: vi.fn(),
}));

import {
  determineVerificationTier,
  classifyAuthenticatorTier,
} from '../src/services/trust.service';
import { extractEmailDomain, isPersonalDomain, isBlockedDomain, classifyDomainType } from '../src/lib/email-domain';

describe('trust.service — determineVerificationTier', () => {
  it('returns verified_institutional for org_email_verified tier', () => {
    expect(determineVerificationTier('org_email_verified', false)).toBe('verified_institutional');
  });

  it('returns verified_institutional when whitelisted regardless of tier', () => {
    expect(determineVerificationTier('personal_email', true)).toBe('verified_institutional');
    expect(determineVerificationTier('unverified', true)).toBe('verified_institutional');
  });

  it('returns verified_basic for personal_email tier not whitelisted', () => {
    expect(determineVerificationTier('personal_email', false)).toBe('verified_basic');
  });

  it('returns verified_basic for unverified tier not whitelisted', () => {
    expect(determineVerificationTier('unverified', false)).toBe('verified_basic');
  });

  it('returns verified_basic for org_email_unverified', () => {
    expect(determineVerificationTier('org_email_unverified', false)).toBe('verified_basic');
  });
});

describe('email-domain helpers', () => {
  it('extracts domain correctly', () => {
    expect(extractEmailDomain('user@company.com')).toBe('company.com');
    expect(extractEmailDomain('user@sub.org.edu')).toBe('sub.org.edu');
    expect(extractEmailDomain('notanemail')).toBeNull();
  });

  it('identifies personal domains', () => {
    expect(isPersonalDomain('gmail.com')).toBe(true);
    expect(isPersonalDomain('yahoo.com')).toBe(true);
    expect(isPersonalDomain('hotmail.com')).toBe(true);
    expect(isPersonalDomain('company.com')).toBe(false);
  });

  it('identifies blocked domains', () => {
    expect(isBlockedDomain('mailinator.com')).toBe(true);
    expect(isBlockedDomain('guerrillamail.com')).toBe(true);
    expect(isBlockedDomain('gmail.com')).toBe(false);
  });

  it('classifies domain types', () => {
    expect(classifyDomainType('gmail.com')).toBe('personal');
    expect(classifyDomainType('mailinator.com')).toBe('blocked');
    expect(classifyDomainType('redcross.org')).toBe('org_unverified');
  });
});
