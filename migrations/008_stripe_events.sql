-- Idempotency log for Stripe webhook events
create table if not exists public.stripe_events (
  id            uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  type          text not null,
  processed_at  timestamptz not null default now()
);

-- Auto-expire after 30 days (kept for audit trail)
create index if not exists idx_stripe_events_processed_at on public.stripe_events(processed_at);
