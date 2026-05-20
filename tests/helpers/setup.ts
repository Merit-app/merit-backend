/**
 * Shared test helpers and factory functions.
 * Import into individual test files as needed.
 */
import { vi } from 'vitest';

// ─── Supabase mock factory ────────────────────────────────────────────────────

/**
 * Creates a chainable Supabase mock where every method returns the chain
 * and awaiting resolves to { data, error }.
 */
export function makeSupabaseMock(
  tableMap: Record<string, () => any> = {},
  defaultData: any = null,
) {
  const makeChain = (resolveWith: () => any) => {
    const chain: any = {};
    const chainMethods = [
      'select', 'eq', 'neq', 'is', 'gte', 'lte', 'lt', 'gt',
      'in', 'or', 'order', 'limit', 'range', 'not', 'filter',
    ];
    chainMethods.forEach((m) => { chain[m] = vi.fn(() => chain); });
    chain.maybeSingle = vi.fn(() => Promise.resolve({ data: resolveWith(), error: null }));
    chain.single = vi.fn(() => Promise.resolve({ data: resolveWith(), error: null }));
    chain.insert = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: resolveWith(), error: null }) }),
    }));
    chain.update = vi.fn(() => ({
      eq: () => Promise.resolve({ data: null, error: null }),
    }));
    chain.delete = vi.fn(() => ({
      eq: () => Promise.resolve({ data: null, error: null }),
      lt: () => Promise.resolve({ data: null, error: null }),
      not: () => Promise.resolve({ data: null, error: null }),
    }));
    chain.upsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
    chain.then = (resolve: any) =>
      Promise.resolve({ data: resolveWith(), error: null, count: 0 }).then(resolve);
    return chain;
  };

  return {
    from: (table: string) => makeChain(tableMap[table] ?? (() => defaultData)),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user-1' }, session: { access_token: 'tok' } }, error: null }),
      admin: {
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
      },
    },
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://mock.storage/file.pdf' } }),
      }),
    },
    rpc: vi.fn().mockResolvedValue({ data: [{ success_count: 0, total_count: 0 }], error: null }),
    channel: () => ({ on: () => ({ subscribe: vi.fn() }) }),
  };
}

// ─── Common mock data factories ───────────────────────────────────────────────

export function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'student',
    plan: 'free',
    date_of_birth: '2000-01-01',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeSession(overrides: Record<string, any> = {}) {
  return {
    id: 'session-1',
    user_id: 'user-1',
    org_id: 'org-1',
    date: '2026-05-01',
    hours: 4,
    status: 'pending',
    supervisor_name: 'Jane Supervisor',
    supervisor_phone: '+16045551234',
    supervisor_email: 'supervisor@org.com',
    fraud_score: 0,
    fraud_flags: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeVerification(overrides: Record<string, any> = {}) {
  return {
    id: 'verification-1',
    session_id: 'session-1',
    method: 'sms',
    supervisor_phone: '+16045551234',
    supervisor_name: 'Jane Supervisor',
    sent_at: new Date().toISOString(),
    reminded_at: null,
    ...overrides,
  };
}
