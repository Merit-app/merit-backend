-- ─── SUBSCRIPTIONS ────────────────────────────────────────────────
create table public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  stripe_subscription_id text unique not null,
  stripe_customer_id text not null,
  stripe_price_id text not null,
  plan text not null check (plan in ('pro', 'premium', 'institutional')),
  status text not null check (status in (
    'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired'
  )),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_subscriptions_user on public.subscriptions(user_id);
create index idx_subscriptions_stripe_id on public.subscriptions(stripe_subscription_id);
create index idx_subscriptions_status on public.subscriptions(status);

-- ─── INVOICES (synced from Stripe) ────────────────────────────────
create table public.invoices (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id),
  stripe_invoice_id text unique not null,
  amount_paid_cents integer not null,
  currency text not null default 'usd',
  status text not null check (status in ('draft', 'open', 'paid', 'uncollectible', 'void')),
  hosted_invoice_url text,
  invoice_pdf_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_invoices_user on public.invoices(user_id, created_at desc);

-- ─── STRIPE EVENT LOG (idempotency) ───────────────────────────────
create table public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now(),
  data jsonb
);

-- updated_at trigger for subscriptions
create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
