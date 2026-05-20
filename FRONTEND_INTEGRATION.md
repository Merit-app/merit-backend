# Frontend Integration Guide

## Base URL

Set in your frontend `.env`:

```
VITE_API_URL=http://localhost:3001       # development
VITE_API_URL=https://your-api.up.railway.app  # production
```

## Authentication

All protected endpoints require a Supabase JWT in the `Authorization` header:

```
Authorization: Bearer <supabase_access_token>
```

Get the token from `supabase.auth.getSession()` and attach it to every request.

## Response shape

**Success:** `{ data: <payload> }`  
**Paginated:** `{ data: [...], meta: { total, page, perPage, hasMore } }`  
**Error:** `{ error: "error_code", message: "...", details?: {} }`

## Realtime notifications

Subscribe directly via the Supabase client — no backend WebSocket needed:

```ts
supabase
  .channel('notifications')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'notifications',
    filter: `user_id=eq.${userId}`,
  }, (payload) => {
    // show toast / update badge
  })
  .subscribe();
```

## Key endpoints

| Action | Method | Path |
|--------|--------|------|
| Sign up | POST | `/auth/signup` |
| Log in | POST | `/auth/login` |
| Get profile | GET | `/auth/me` |
| List sessions | GET | `/sessions` |
| Create session | POST | `/sessions` |
| Session stats | GET | `/stats/dashboard` |
| Weekly chart | GET | `/stats/weekly?weeks=12` |
| Monthly chart | GET | `/stats/by-month?year=YYYY` |
| Notifications | GET | `/notifications` |
| Unread count | GET | `/notifications/unread-count` |
| Billing checkout | POST | `/billing/create-checkout` |
| Billing portal | POST | `/billing/create-portal` |
| Export PDF | POST | `/exports/pdf` |
| Verify hours (magic link) | GET | `/magic/verify?token=...&response=YES` |
| Admin chapter | GET | `/admin/chapter` |
| Grant report | GET | `/admin/reports/grant` |

## Stripe checkout flow

```ts
const { data } = await api.post('/billing/create-checkout', { priceId: 'price_pro_monthly' });
window.location.href = data.url; // redirect to Stripe
```

## Environment variables needed in Railway

Copy `.env.example` and set all values in the Railway dashboard under  
**Project → Variables**. Required in production:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`
- `MAGIC_LINK_SECRET`, `COOKIE_SECRET`
- `FRONTEND_URL` (your Vercel/Netlify URL)
- `REDIS_URL` (optional — enables BullMQ queues)
