-- ─── AUTHENTICATORS ───────────────────────────────────────────────
create table public.authenticators (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text,
  email_lower text generated always as (lower(email)) stored,
  email_domain text generated always as (
    case
      when email is not null
      then lower(split_part(email, '@', 2))
      else null
    end
  ) stored,
  phone text,

  -- Tier classification
  tier text not null default 'unverified' check (tier in (
    'unverified',
    'personal_email',
    'org_email_unverified',
    'org_email_verified'
  )),

  -- Org association
  org_id uuid references public.organizations(id),

  -- Activity tracking
  total_verifications integer not null default 0,
  successful_verifications integer not null default 0,
  failed_verifications integer not null default 0,
  unique_students_verified integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_verified_at timestamptz,

  -- Manual overrides
  manually_promoted boolean not null default false,
  manually_demoted boolean not null default false,
  promoted_by uuid references public.users(id),
  promotion_reason text,

  check (email is not null or phone is not null),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index idx_authenticator_email on public.authenticators(email_lower) where email is not null;
create unique index idx_authenticator_phone on public.authenticators(phone) where phone is not null;
create index idx_authenticator_domain on public.authenticators(email_domain) where email_domain is not null;
create index idx_authenticator_org on public.authenticators(org_id) where org_id is not null;
create index idx_authenticator_tier on public.authenticators(tier);

-- ─── ORG EMAIL DOMAINS ────────────────────────────────────────────
create table public.org_email_domains (
  id uuid primary key default uuid_generate_v4(),
  domain text not null unique,
  org_id uuid references public.organizations(id),

  -- Trust metrics
  unique_authenticator_count integer not null default 0,
  successful_verification_count integer not null default 0,
  failed_verification_count integer not null default 0,
  trust_score numeric(3,2) not null default 0.0 check (trust_score between 0.0 and 1.0),
  trust_score_updated_at timestamptz,

  -- Trust signals
  matches_org_website boolean not null default false,
  matches_propublica_ein_holder boolean not null default false,
  manually_verified boolean not null default false,
  manually_blocked boolean not null default false,

  -- Classification
  domain_type text not null default 'unknown' check (domain_type in (
    'unknown',
    'personal',
    'org_unverified',
    'org_verified',
    'institutional',
    'blocked'
  )),

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_org_email_domains_org on public.org_email_domains(org_id) where org_id is not null;
create index idx_org_email_domains_type on public.org_email_domains(domain_type);
create index idx_org_email_domains_trust on public.org_email_domains(trust_score desc);

-- Seed known personal email domains
insert into public.org_email_domains (domain, domain_type, trust_score) values
  ('gmail.com', 'personal', 0.1),
  ('googlemail.com', 'personal', 0.1),
  ('yahoo.com', 'personal', 0.1),
  ('yahoo.ca', 'personal', 0.1),
  ('hotmail.com', 'personal', 0.1),
  ('hotmail.ca', 'personal', 0.1),
  ('outlook.com', 'personal', 0.1),
  ('live.com', 'personal', 0.1),
  ('icloud.com', 'personal', 0.1),
  ('me.com', 'personal', 0.1),
  ('aol.com', 'personal', 0.1),
  ('proton.me', 'personal', 0.1),
  ('protonmail.com', 'personal', 0.1);

-- Seed known disposable / blocked domains
insert into public.org_email_domains (domain, domain_type, manually_blocked, trust_score) values
  ('mailinator.com', 'blocked', true, 0.0),
  ('guerrillamail.com', 'blocked', true, 0.0),
  ('tempmail.com', 'blocked', true, 0.0),
  ('10minutemail.com', 'blocked', true, 0.0),
  ('throwaway.email', 'blocked', true, 0.0);

-- Add FK from sessions.authenticator_id → authenticators.id (now that authenticators exists)
alter table public.sessions
  add constraint fk_sessions_authenticator
  foreign key (authenticator_id) references public.authenticators(id) on delete set null;

-- updated_at trigger for authenticators
create trigger trg_authenticators_updated_at
  before update on public.authenticators
  for each row execute function public.set_updated_at();

create trigger trg_org_email_domains_updated_at
  before update on public.org_email_domains
  for each row execute function public.set_updated_at();
