# Google SSO — Implementation Guide

> Status: **not yet wired into the live login flow.** This is the exact recipe to add
> "Continue with Google" without breaking the existing email/password auth. Do the
> dashboard steps first, then the code, then test on a preview deploy before prod.

Why it's staged this way: the app's session is Supabase-issued (the backend calls
`signInWithPassword` and returns Supabase access/refresh tokens). Google OAuth via
Supabase returns the *same kind* of session, so it slots into the existing store —
but it needs a browser Supabase client (a new dependency) and a first-login profile
row, so it must be added deliberately and tested.

---

## Step 1 — Google Cloud Console (you)

1. https://console.cloud.google.com → create/select a project.
2. **APIs & Services → OAuth consent screen** → External → fill app name, support email.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URI:
     `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (find `<your-project-ref>` in Supabase → Project Settings → API)
4. Copy the **Client ID** and **Client Secret**.

## Step 2 — Supabase dashboard (you)

1. **Authentication → Providers → Google** → enable.
2. Paste the Client ID + Client Secret → Save.
3. **Authentication → URL Configuration → Redirect URLs**: add
   `https://meritco.app/auth/callback` and `http://localhost:3000/auth/callback`.

## Step 3 — Frontend: add a Supabase browser client

```bash
cd merit-frontend && npm install @supabase/supabase-js
```

`merit-frontend/lib/supabase-browser.ts`:
```ts
import { createClient } from '@supabase/supabase-js';

// Browser-only client used solely for OAuth sign-in. The app's API calls still go
// through the backend; this just performs the OAuth handshake and code exchange.
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { flowType: 'pkce', persistSession: false, autoRefreshToken: false } },
);
```

Ensure these are set in Vercel env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Step 4 — "Continue with Google" button

Add to `app/(marketing)/login/page.tsx` and `signup/page.tsx`:
```tsx
'use client';
import { supabaseBrowser } from '@/lib/supabase-browser';

function GoogleButton() {
  async function signIn() {
    await supabaseBrowser.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?sso=google` },
    });
  }
  return (
    <button onClick={signIn} className="w-full rounded-lg border border-border py-2.5 text-sm font-medium hover:bg-muted">
      Continue with Google
    </button>
  );
}
```

## Step 5 — Handle the OAuth code in the callback

Extend `app/auth/callback/route.ts`. **This must run client-side for `exchangeCodeForSession`**,
so add a small client page OR exchange server-side via the backend. Simplest robust path —
a dedicated client page `app/auth/sso/page.tsx`:
```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { useMeritStore } from '@/lib/store';

export default function SsoExchange() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      if (!code) return router.replace('/login?error=sso');
      const { data, error } = await supabaseBrowser.auth.exchangeCodeForSession(code);
      if (error || !data.session) return router.replace('/login?error=sso');

      // Ensure a public.users profile row exists for first-time Google users.
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/ensure-profile`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });

      useMeritStore.getState().setTokens(
        data.session.access_token,
        data.session.refresh_token,
        new Date(data.session.expires_at! * 1000).toISOString(),
      );
      router.replace('/dashboard');
    })();
  }, [router]);
  return <p className="p-8 text-muted-foreground">Signing you in…</p>;
}
```
Point the Google button's `redirectTo` at `/auth/sso` instead of `/auth/callback`.

## Step 6 — Backend: ensure a profile row on first OAuth login

`POST /auth/ensure-profile` (protected by `requireAuth`): if no `public.users` row
exists for the authenticated Supabase user, create one from the Google identity.
```ts
router.post('/auth/ensure-profile', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { data: existing } = await supabaseAdmin
      .from('users').select('id').eq('id', userId).maybeSingle();
    if (!existing) {
      await supabaseAdmin.from('users').insert({
        id: userId,
        email: req.user!.email,
        name: req.authUser?.email?.split('@')[0] ?? 'Student',
        plan: 'free',
      });
    }
    res.json(success({ ok: true }));
  } catch (err) { next(err); }
});
```
> Note: `requireAuth` currently 401s if the users row is missing. For the ensure-profile
> route, use a lighter guard that only validates the Supabase token (don't require the
> users row), or temporarily verify the token inline. Otherwise first-time Google users
> can't reach this endpoint to create their row.

## Step 7 — Test on a PREVIEW deploy first
1. Deploy to a Vercel preview, set the env vars there.
2. Sign in with a test Google account → confirm you land on /dashboard and a users row was created.
3. Only then enable on production.

---

### Microsoft / Azure (later)
Identical flow — enable the **Azure** provider in Supabase, register an app in Entra ID,
add `provider: 'azure'` with `options.scopes: 'email'`. Add a second button.
```
