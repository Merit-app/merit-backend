-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

-- ─── USERS ────────────────────────────────────────────────────────
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  email_lower text generated always as (lower(email)) stored,
  name text not null,
  age_tier text not null check (age_tier in ('under_13', 'minor', 'adult')),
  date_of_birth date,
  school text,
  grade integer check (grade between 6 and 12),
  graduation_year integer,
  phone text,

  -- Plan tracking
  plan text not null default 'free' check (plan in ('free', 'pro', 'premium', 'institutional')),
  plan_started_at timestamptz,
  plan_expires_at timestamptz,
  stripe_customer_id text unique,

  -- Goals
  goal_program text check (goal_program in ('NHS', 'IB', 'graduation', 'scholarship', 'personal', 'other')),
  goal_hours integer default 75,
  goal_started_at date default current_date,

  -- Status flags
  email_confirmed boolean not null default false,
  email_confirmed_at timestamptz,
  is_minor boolean not null default false,
  parental_consent_received boolean not null default false,
  parental_consent_at timestamptz,
  parental_consent_email text,
  account_locked_until timestamptz,
  failed_login_attempts integer not null default 0,

  -- Institutional (chapter FK added in migration 007 after chapters table exists)
  chapter_id uuid,
  role text not null default 'student' check (role in ('student', 'coordinator', 'admin')),

  -- Preferences
  notifications jsonb not null default '{"smsVerification":true,"weeklyProgress":true,"goalMilestones":true,"productUpdates":false,"marketingEmails":false}'::jsonb,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,

  -- Soft delete
  deleted_at timestamptz,
  deletion_scheduled_for timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_users_email_lower on public.users(email_lower);
create index idx_users_chapter on public.users(chapter_id) where chapter_id is not null;
create index idx_users_deleted on public.users(deleted_at) where deleted_at is not null;
create index idx_users_plan on public.users(plan);

-- ─── ORGANIZATIONS ────────────────────────────────────────────────
create table public.organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  ein text unique,
  city text,
  state text,
  country text default 'US',
  category text,
  ntee_code text,
  website text,
  website_domain text generated always as (
    case
      when website is not null
      then lower(regexp_replace(regexp_replace(website, '^https?://(www\.)?', ''), '/.*$', ''))
      else null
    end
  ) stored,

  -- Trust signals
  is_registered_nonprofit boolean not null default false,
  is_institutional_partner boolean not null default false,
  internal_trust_score numeric(3,2) not null default 0.0 check (internal_trust_score between 0.0 and 1.0),
  trust_score_updated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_orgs_name on public.organizations using gin(name gin_trgm_ops);
create index idx_orgs_ein on public.organizations(ein) where ein is not null;
create index idx_orgs_domain on public.organizations(website_domain) where website_domain is not null;

-- ─── SESSIONS (volunteer hour entries) ────────────────────────────
-- Note: authenticator_id FK added in migration 005 after authenticators table exists
create table public.sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  date date not null,
  hours numeric(4,1) not null check (hours > 0 and hours <= 12),
  activity text not null check (length(activity) between 1 and 500),

  -- Supervisor info
  supervisor_name text not null check (length(supervisor_name) between 1 and 100),
  supervisor_phone text,
  supervisor_email text,
  authenticator_id uuid,  -- FK to authenticators added in 005

  -- Verification state
  status text not null default 'pending' check (status in ('pending', 'verified', 'disputed', 'expired')),
  verification_tier text check (verification_tier in (
    'unverified',
    'verified_basic',
    'verified_institutional'
  )),
  verified_at timestamptz,
  verified_by text,

  -- Fraud signals
  fraud_score numeric(3,2) not null default 0.0,
  fraud_flags text[] default '{}',
  manually_reviewed boolean not null default false,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,

  -- Soft delete
  deleted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sessions_user on public.sessions(user_id, date desc) where deleted_at is null;
create index idx_sessions_status on public.sessions(user_id, status) where deleted_at is null;
create index idx_sessions_org on public.sessions(org_id) where deleted_at is null;
create index idx_sessions_fraud on public.sessions(fraud_score desc) where fraud_score > 0.5;
create index idx_sessions_pending_review on public.sessions(created_at) where manually_reviewed = false and fraud_score > 0.7;

-- ─── VERIFICATIONS (SMS/email attempts) ───────────────────────────
create table public.verifications (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  channel text not null check (channel in ('sms', 'email')),
  destination text not null,
  twilio_sid text,
  resend_id text,
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  response text check (response in ('YES', 'NO', 'STOP')),
  response_method text check (response_method in ('sms_reply', 'magic_link_click', 'email_reply')),
  reminder_count integer not null default 0,

  -- For magic-link confirmations
  confirmation_token text unique,
  token_expires_at timestamptz
);

create index idx_verifications_session on public.verifications(session_id);
create index idx_verifications_phone on public.verifications(destination) where channel = 'sms';
create index idx_verifications_token on public.verifications(confirmation_token) where confirmation_token is not null;
create index idx_verifications_pending on public.verifications(sent_at) where responded_at is null;

-- ─── SMS OPT-OUTS ─────────────────────────────────────────────────
create table public.sms_opt_outs (
  phone text primary key,
  opted_out_at timestamptz not null default now()
);

create table public.email_opt_outs (
  email text primary key,
  email_lower text generated always as (lower(email)) stored,
  reason text,
  opted_out_at timestamptz not null default now()
);

create index idx_email_opt_outs_lower on public.email_opt_outs(email_lower);

-- ─── RATE LIMITS ──────────────────────────────────────────────────
create table public.rate_limits (
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null,
  date date not null default current_date,
  count integer not null default 1,
  primary key (user_id, action, date)
);

create table public.ip_rate_limits (
  ip_address text not null,
  action text not null,
  hour timestamptz not null,
  count integer not null default 1,
  primary key (ip_address, action, hour)
);

create index idx_ip_rate_limits_cleanup on public.ip_rate_limits(hour);

-- ─── AUDIT LOG ────────────────────────────────────────────────────
create table public.audit_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id uuid,
  metadata jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_audit_user on public.audit_log(user_id, created_at desc);
create index idx_audit_action on public.audit_log(action, created_at desc);
create index idx_audit_resource on public.audit_log(resource_type, resource_id);
