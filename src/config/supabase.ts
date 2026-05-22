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
      createUser: async (_attrs: any) => ({ data: { user: { id: 'mock-user-id', email: _attrs.email } }, error: null }),
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

// Normalize SUPABASE_URL: strip trailing slash and any /rest/v1 or /auth/v1 suffix
// so the Supabase client always receives the bare project URL.
// This handles the common mistake of setting SUPABASE_URL to the PostgREST endpoint.
function normalizeSupabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let url = raw.replace(/\/+$/, '');               // strip trailing slashes
  url = url.replace(/\/(rest|auth)\/v\d+.*$/, ''); // strip known path suffixes
  return url;
}

const isReal = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

export const SUPABASE_MODE: 'real' | 'mock' = isReal ? 'real' : 'mock';

let supabaseAdminInstance: typeof mockSupabase | any;
let supabaseAuthInstance: typeof mockSupabase | any;

if (isReal) {
  const { createClient } = require('@supabase/supabase-js');
  const projectUrl = normalizeSupabaseUrl(env.SUPABASE_URL)!;
  // Service-role client — used ONLY for DB operations. Never call auth.signIn/signUp
  // on this client or it contaminates the shared session with the user's JWT.
  supabaseAdminInstance = createClient(projectUrl, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Anon client — used for auth operations (signInWithPassword, refreshSession, etc.)
  // Safe to call auth methods on; uses anon key so DB access is RLS-gated.
  supabaseAuthInstance = createClient(projectUrl, env.SUPABASE_ANON_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
} else {
  supabaseAdminInstance = mockSupabase;
  supabaseAuthInstance = mockSupabase;
}

export const supabaseAdmin = supabaseAdminInstance;
// Use supabaseAuth for signInWithPassword, refreshSession, resetPassword etc.
export const supabaseAuth = supabaseAuthInstance;
