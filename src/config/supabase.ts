import { env } from './env';

function createMockChain(): any {
  const chain: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: any) => any) => Promise.resolve({ data: null, error: null }).then(resolve);
        }
        if (prop === 'catch') {
          return (reject: (v: any) => any) => Promise.resolve({ data: null, error: null }).catch(reject);
        }
        if (prop === 'finally') {
          return (fn: () => void) => Promise.resolve({ data: null, error: null }).finally(fn);
        }
        return (..._args: any[]) => chain;
      },
    },
  );
  return chain;
}

const mockSupabase = {
  from: (_table: string) => createMockChain(),
  rpc: (_fn: string, _params?: any) => createMockChain(),
  auth: {
    getUser: async (_token?: string) => ({ data: { user: null }, error: null }),
    signUp: async (_creds: any) => ({ data: null, error: null }),
    signInWithPassword: async (_creds: any) => ({ data: null, error: null }),
    admin: {
      deleteUser: async (_id: string) => ({ data: null, error: null }),
      getUserById: async (_id: string) => ({ data: { user: null }, error: null }),
    },
  },
  storage: {
    from: (_bucket: string) => ({
      upload: async (_path: string, _file: any, _opts?: any) => ({ data: null, error: null }),
      createSignedUrl: async (_path: string, _expiresIn: number) => ({
        data: { signedUrl: 'mock://signed-url' },
        error: null,
      }),
      getPublicUrl: (_path: string) => ({ data: { publicUrl: 'mock://public-url' } }),
    }),
  },
  channel: (_name: string) => ({
    on: (_event: string, _filter: any, _cb?: any) => ({
      subscribe: (_cb?: any) => ({ unsubscribe: () => {} }),
    }),
  }),
};

const isReal = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

export const SUPABASE_MODE: 'real' | 'mock' = isReal ? 'real' : 'mock';

let supabaseAdminInstance: typeof mockSupabase | any;

if (isReal) {
  // Dynamic import to avoid pulling in the SDK when in mock mode
  const { createClient } = require('@supabase/supabase-js');
  supabaseAdminInstance = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
} else {
  supabaseAdminInstance = mockSupabase;
}

export const supabaseAdmin = supabaseAdminInstance;
