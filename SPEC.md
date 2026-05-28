# Merit — Backend Build Specification (v2 — Complete)
> This document is the source of truth for the Merit backend. Read it fully before writing any code. Refer back to it whenever a design or architecture decision needs to be made. **Do not deviate from this document without explicit confirmation.**
> **Permission to install dependencies:** Claude Code has full permission to install any npm package, CLI tool, or system dependency needed to fulfill this specification. Use the latest stable version of each unless otherwise specified.
> **Version 2 changelog:** Added complete payment/billing system (Stripe), Trust & Verification System (two-tier authenticator model), Institutional tier endpoints, fraud detection, error monitoring (Sentry), notifications system, all email templates, auth hardening (lockout, password strength, magic links), PDF export security, CI/CD pipeline, legal/compliance section, and expanded database schema.
---
## Table of Contents
1. The Identity
2. Tech Stack
3. Architecture Overview
4. Project Structure
5. Database Schema
6. Environment Variables
7. API Routes — Complete Reference
8. Authentication & Account Security
9. Trust & Verification System (Core Differentiator)
10. SMS Verification System
11. Email System & Templates
12. Organization Verification (ProPublica + Internal Trust)
13. Rate Limiting (Per Plan)
14. Payment & Billing System (Stripe)
15. Institutional Tier
16. Notifications System
17. Stats & Dashboard Endpoints
18. Security
19. Mock Mode vs Real Mode
20. Background Jobs
21. Logging & Error Monitoring
22. Testing
23. CI/CD Pipeline
24. Deployment (Railway)
25. Error Handling
26. Legal & Compliance (COPPA, PIPEDA, CASL, GDPR)
27. PDF Export Security
28. What NOT to Do
29. Definition of Done
30. Setup Instructions
31. Build Order
32. Integration Checklist
33. One Last Thing
---
## 1. The Identity
**Merit's backend is a credible, secure, professionally-architected API.** It is not a quick prototype. It is not a "hackathon backend." It is the kind of code a senior engineer at Google or Stripe would write: cleanly separated concerns, defensive validation everywhere, real logging, real error handling, real security.
The backend serves the Merit frontend (Next.js, deployed at merit-frontend on Vercel) and handles every operation that requires server-side secrets, persistent storage, third-party API access, or business logic that cannot live on the client.
**The single most important rule: this is a real production-grade backend, not a placeholder.** Every endpoint validates input. Every operation is logged. Every error has a sensible response. Every secret lives in environment variables. Every external service has a mock mode for local development.
**The trust layer is sacred.** A student's volunteer hours will be used for college applications, NHS membership, and graduation requirements. If verification can be faked, the product is worthless. If data leaks, the product is actively harmful. Build defensively.
---
## 2. Tech Stack — Use Exactly These



```
Runtime:           Node.js 20 LTS
Language:          TypeScript 5 (strict mode)
Framework:         Express 4
Database:          Supabase (Postgres 15+)
Auth:              Supabase Auth (JWT-based)
SMS:               Twilio (Messaging Services)
Email:             Resend
Payments:          Stripe (Subscriptions + Tax)
Error monitoring:  Sentry (@sentry/node)
Validation:        Zod
Logging:           Pino + pino-pretty
Security headers:  Helmet
CORS:              cors
Request logging:   Morgan (HTTP access logs)
Rate limiting:     Custom middleware (DB-backed, not in-memory)
Background jobs:   node-cron for scheduled tasks
Job queue:         BullMQ (Redis-backed, for async work)
HTTP client:       undici (built into Node 20)
Password strength: zxcvbn-ts
Phone validation:  libphonenumber-js
Testing:           Vitest + Supertest
Hosting:           Railway
External API:      ProPublica Nonprofit Explorer
Analytics:         PostHog (server-side events)
Storage:           Supabase Storage (signed URLs for PDFs)
CI/CD:             GitHub Actions
```






Install dependencies in this order so commits are clean:
1. Express, TypeScript, ts-node-dev, types
2. Zod, Pino, Helmet, cors, morgan
3. @supabase/supabase-js, twilio, resend, posthog-node
4. stripe, @sentry/node
5. zxcvbn-ts, libphonenumber-js
6. node-cron, undici, bullmq
7. Vitest, supertest (dev dependencies)
---
## 3. Architecture Overview
The backend is a **stateless REST API** that the Next.js frontend calls. It does not render HTML. It does not serve static assets. It does one thing: respond to JSON requests with JSON responses.
**Request flow:**



```
Frontend (Vercel)
   ↓ HTTPS + JWT in Authorization header
Backend (Railway)
   ↓
Middleware stack:
   1. Sentry request handler
   2. Helmet (security headers)
   3. CORS (allow frontend origin only)
   4. Morgan (log every request)
   5. JSON body parser (with 1MB limit)
   6. Request ID injection (for tracing)
   7. Auth middleware (verify Supabase JWT)
   8. Rate limit middleware (per-route)
   9. Zod validation (per-route)
   ↓
Route handler:
   - Calls service layer (twilio.service, stripe.service, etc.)
   - Service layer calls Supabase or third-party APIs
   - Returns shaped JSON response
   ↓
Sentry error handler → Global error handler middleware
```






**Key principle:** Routes are thin. Services are fat. Routes parse input, call services, format output. Services contain the business logic and talk to databases and third-party APIs. This makes everything testable and replaceable.
**Async work pattern:** Anything that can block the request loop (sending emails, hitting third-party APIs, generating PDFs) gets pushed to a BullMQ queue. The HTTP response returns immediately with a "queued" status; the work completes in the background.
---
## 4. Project Structure



```
merit-backend/
├── src/
│   ├── server.ts                       # Entry point
│   ├── app.ts                          # Express app config
│   ├── config/
│   │   ├── env.ts                      # Validated environment vars
│   │   ├── supabase.ts                 # Supabase client (real + mock)
│   │   ├── twilio.ts                   # Twilio client (real + mock)
│   │   ├── resend.ts                   # Resend client (real + mock)
│   │   ├── stripe.ts                   # Stripe client (real + mock)
│   │   ├── sentry.ts                   # Sentry init
│   │   ├── posthog.ts                  # PostHog client
│   │   └── redis.ts                    # Redis client for BullMQ
│   ├── routes/
│   │   ├── auth.routes.ts              # /auth/*
│   │   ├── sessions.routes.ts          # /sessions/*
│   │   ├── organizations.routes.ts     # /organizations/*
│   │   ├── verifications.routes.ts     # /verifications/*
│   │   ├── users.routes.ts             # /users/*
│   │   ├── stats.routes.ts             # /stats/*
│   │   ├── notifications.routes.ts     # /notifications/*
│   │   ├── billing.routes.ts           # /billing/*
│   │   ├── admin.routes.ts             # /admin/* (institutional)
│   │   ├── exports.routes.ts           # /exports/*
│   │   ├── magic-link.routes.ts        # /magic/* (supervisor logins)
│   │   └── webhooks.routes.ts          # /webhooks/twilio, /webhooks/stripe, etc.
│   ├── middleware/
│   │   ├── auth.middleware.ts          # JWT verification
│   │   ├── role.middleware.ts          # Role-based access (student/coordinator/admin)
│   │   ├── rate-limit.middleware.ts    # Per-route rate limiting
│   │   ├── validate.middleware.ts      # Zod-based validation
│   │   ├── plan-gate.middleware.ts     # Feature gating by plan
│   │   ├── request-id.middleware.ts    # Inject X-Request-ID
│   │   ├── error-handler.middleware.ts # Catches all errors
│   │   └── not-found.middleware.ts     # 404 handler
│   ├── services/
│   │   ├── auth.service.ts             # Signup, login, password reset, lockout
│   │   ├── sessions.service.ts         # Session CRUD
│   │   ├── organizations.service.ts    # Org search, cache, trust scoring
│   │   ├── verifications.service.ts    # SMS/email sending, response handling
│   │   ├── trust.service.ts            # ⭐ Authenticator + org trust scoring
│   │   ├── fraud.service.ts            # ⭐ Anomaly + velocity detection
│   │   ├── users.service.ts            # User profile
│   │   ├── stats.service.ts            # Dashboard data aggregation
│   │   ├── notifications.service.ts    # In-app notifications
│   │   ├── billing.service.ts          # ⭐ Stripe subscription management
│   │   ├── admin.service.ts            # ⭐ Institutional admin operations
│   │   ├── twilio.service.ts           # SMS abstraction (mock + real)
│   │   ├── resend.service.ts           # Email abstraction (mock + real)
│   │   ├── stripe.service.ts           # Stripe abstraction (mock + real)
│   │   ├── propublica.service.ts       # ProPublica API client
│   │   ├── pdf.service.ts              # Server-side PDF generation
│   │   ├── storage.service.ts          # Supabase Storage (signed URLs)
│   │   ├── magic-link.service.ts       # Passwordless supervisor login
│   │   └── analytics.service.ts        # PostHog event tracking
│   ├── lib/
│   │   ├── logger.ts                   # Pino logger instance
│   │   ├── errors.ts                   # Custom error classes
│   │   ├── jwt.ts                      # JWT helpers
│   │   ├── phone.ts                    # Phone formatting/validation
│   │   ├── email-domain.ts             # ⭐ Domain extraction + classification
│   │   ├── password.ts                 # zxcvbn strength check
│   │   └── crypto.ts                   # Token generation, hashing
│   ├── schemas/
│   │   ├── auth.schema.ts              # Zod schemas
│   │   ├── sessions.schema.ts
│   │   ├── organizations.schema.ts
│   │   ├── verifications.schema.ts
│   │   ├── users.schema.ts
│   │   ├── billing.schema.ts
│   │   ├── admin.schema.ts
│   │   └── stats.schema.ts
│   ├── types/
│   │   ├── index.ts                    # Shared types
│   │   ├── database.types.ts           # Auto-generated from Supabase
│   │   └── express.d.ts                # Express req/res augmentation
│   ├── jobs/
│   │   ├── weekly-digest.job.ts        # Sends weekly email
│   │   ├── verification-reminder.job.ts # Reminds supervisors after 24h
│   │   ├── trust-score-refresh.job.ts  # ⭐ Recalculate org trust scores
│   │   ├── fraud-scan.job.ts           # ⭐ Daily fraud anomaly scan
│   │   ├── cleanup.job.ts              # Expire old verifications
│   │   ├── milestone.job.ts            # Goal milestone email triggers
│   │   ├── data-retention.job.ts       # GDPR-compliant data deletion
│   │   └── index.ts                    # Cron registration
│   ├── queues/
│   │   ├── email.queue.ts              # BullMQ email queue
│   │   ├── sms.queue.ts                # BullMQ SMS queue
│   │   ├── pdf.queue.ts                # BullMQ PDF generation queue
│   │   └── index.ts
│   ├── templates/
│   │   ├── emails/
│   │   │   ├── confirm-email.tsx       # React Email components
│   │   │   ├── password-reset.tsx
│   │   │   ├── weekly-digest.tsx
│   │   │   ├── milestone.tsx
│   │   │   ├── plan-changed.tsx
│   │   │   ├── account-deleted.tsx
│   │   │   ├── institutional-invite.tsx
│   │   │   ├── supervisor-magic-link.tsx
│   │   │   └── verification-receipt.tsx
│   │   └── sms/
│   │       ├── verification.ts
│   │       ├── reminder.ts
│   │       └── opt-out-confirm.ts
│   └── utils/
│       ├── format.ts                   # Date, number, currency formatters
│       ├── shape.ts                    # API response shaping
│       └── pagination.ts               # Cursor/offset pagination helpers
├── migrations/
│   ├── 001_initial_schema.sql
│   ├── 002_indexes.sql
│   ├── 003_rls_policies.sql
│   ├── 004_triggers.sql                # updated_at, audit log triggers
│   ├── 005_trust_system.sql            # ⭐ authenticators, org_email_domains
│   ├── 006_billing.sql                 # ⭐ subscriptions, invoices
│   ├── 007_institutional.sql           # ⭐ chapters, members, supervisor whitelist
│   └── 008_notifications.sql           # notifications, push_tokens
├── tests/
│   ├── auth.test.ts
│   ├── sessions.test.ts
│   ├── verifications.test.ts
│   ├── trust.test.ts                   # ⭐ Trust scoring logic tests
│   ├── billing.test.ts                 # ⭐ Stripe webhook tests
│   ├── fraud.test.ts                   # ⭐ Fraud detection tests
│   └── helpers/
│       └── setup.ts
├── scripts/
│   ├── seed.ts                         # Seed dev database
│   ├── generate-types.ts               # Run supabase gen types
│   └── verify-trust-scores.ts          # Manual trust score recalc
├── .github/
│   └── workflows/
│       ├── ci.yml                      # Test + lint on PR
│       └── deploy.yml                  # Auto-deploy on main
├── .env.example                        # Template with every variable
├── .env                                # Actual secrets (gitignored)
├── .gitignore
├── package.json
├── tsconfig.json
├── nodemon.json
├── railway.json                        # Railway deployment config
└── README.md
```






---
## 5. Database Schema
All tables live in Supabase. Write schema as SQL migration files so they can be re-run on a fresh database.
### `migrations/001_initial_schema.sql`



```sql
-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";  -- For fuzzy text search on orgs
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
  
  -- Institutional
  chapter_id uuid,  -- references chapters(id), see migration 007
  role text not null default 'student' check (role in ('student', 'coordinator', 'admin')),
  
  -- Preferences
  notifications jsonb not null default '{"smsVerification":true,"weeklyProgress":true,"goalMilestones":true,"productUpdates":false,"marketingEmails":false}'::jsonb,
  marketing_consent boolean not null default false,  -- CASL compliance
  marketing_consent_at timestamptz,
  
  -- Soft delete
  deleted_at timestamptz,
  deletion_scheduled_for timestamptz,  -- 30 days after deletion request
  
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
  is_registered_nonprofit boolean not null default false,  -- IRS 990 check passed
  is_institutional_partner boolean not null default false,  -- Has paid institutional account
  internal_trust_score numeric(3,2) not null default 0.0 check (internal_trust_score between 0.0 and 1.0),
  trust_score_updated_at timestamptz,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_orgs_name on public.organizations using gin(name gin_trgm_ops);
create index idx_orgs_ein on public.organizations(ein) where ein is not null;
create index idx_orgs_domain on public.organizations(website_domain) where website_domain is not null;
-- ─── SESSIONS (volunteer hour entries) ────────────────────────────
create table public.sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  date date not null,
  hours numeric(4,1) not null check (hours > 0 and hours <= 12),
  activity text not null check (length(activity) between 1 and 500),
  
  -- Supervisor info (stored on session for audit, but authenticator is the source of truth)
  supervisor_name text not null check (length(supervisor_name) between 1 and 100),
  supervisor_phone text,
  supervisor_email text,
  authenticator_id uuid references public.authenticators(id),  -- see migration 005
  
  -- Verification state
  status text not null default 'pending' check (status in ('pending', 'verified', 'disputed', 'expired')),
  verification_tier text check (verification_tier in (
    'unverified',                    -- Not yet confirmed
    'verified_basic',                -- Confirmed via phone OR personal email
    'verified_institutional'         -- Confirmed via org email OR institutional whitelist
  )),
  verified_at timestamptz,
  verified_by text,
  
  -- Fraud signals
  fraud_score numeric(3,2) not null default 0.0,  -- 0 = safe, 1 = highly suspicious
  fraud_flags text[] default '{}',  -- e.g., {'velocity_anomaly', 'duplicate_supervisor'}
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
  destination text not null,  -- phone or email
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
-- IP-based rate limits (for unauthenticated endpoints)
create table public.ip_rate_limits (
  ip_address text not null,
  action text not null,
  hour timestamptz not null,  -- Truncated to hour
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
```






### `migrations/004_triggers.sql`



```sql
-- Auto-update updated_at on row changes
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
create trigger trg_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();
create trigger trg_sessions_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();
create trigger trg_orgs_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();
```






### `migrations/005_trust_system.sql` ⭐ NEW
This is the heart of Merit's anti-fraud architecture. The two-tier authenticator model creates network-effect-driven trust.



```sql
-- ─── AUTHENTICATORS ───────────────────────────────────────────────
-- Each unique supervisor (by phone or email). Reused across sessions.
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
  
  -- Tier classification (calculated, see trust.service.ts)
  tier text not null default 'unverified' check (tier in (
    'unverified',              -- Just a phone number, anonymous
    'personal_email',          -- Has a personal email (gmail, hotmail, etc.)
    'org_email_unverified',    -- Has org email but domain not yet trusted
    'org_email_verified'       -- Has org email at a trusted domain
  )),
  
  -- Org association (best-effort; nullable)
  org_id uuid references public.organizations(id),
  
  -- Activity tracking (powers trust scoring)
  total_verifications integer not null default 0,
  successful_verifications integer not null default 0,
  failed_verifications integer not null default 0,
  unique_students_verified integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_verified_at timestamptz,
  
  -- Manual overrides (admin can promote/demote)
  manually_promoted boolean not null default false,
  manually_demoted boolean not null default false,
  promoted_by uuid references public.users(id),
  promotion_reason text,
  
  -- Constraints: must have at least one contact method
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
-- Tracks domains used by authenticators. The more unique authenticators 
-- using a domain, the higher its trust. This is the network effect.
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
  manually_blocked boolean not null default false,  -- Known bad domains
  
  -- Classification
  domain_type text not null default 'unknown' check (domain_type in (
    'unknown',
    'personal',           -- gmail.com, hotmail.com, yahoo.com, etc.
    'org_unverified',     -- Custom domain, not yet trusted
    'org_verified',       -- Custom domain, trusted via network effect
    'institutional',      -- Verified institutional partner domain
    'blocked'             -- Known disposable email domain
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
```






### `migrations/006_billing.sql` ⭐ NEW



```sql
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
-- Prevents processing the same webhook event twice
create table public.stripe_events (
  id text primary key,  -- Stripe event ID
  type text not null,
  processed_at timestamptz not null default now(),
  data jsonb
);
```






### `migrations/007_institutional.sql` ⭐ NEW



```sql
-- ─── CHAPTERS (institutional accounts) ────────────────────────────
create table public.chapters (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  type text not null check (type in ('school', 'nonprofit', 'church', 'troop', 'club', 'other')),
  
  -- Contact info
  primary_coordinator_id uuid references public.users(id),
  contact_email text not null,
  contact_phone text,
  
  -- Address
  address_line text,
  city text,
  state text,
  postal_code text,
  country text default 'US',
  
  -- Branding (Institutional tier perk)
  logo_url text,
  primary_color text,
  
  -- Subscription
  subscription_id uuid references public.subscriptions(id),
  max_members integer not null default 100,
  active boolean not null default true,
  
  -- Verified domain (for auto-verifying supervisor emails)
  verified_email_domain text,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_chapters_coordinator on public.chapters(primary_coordinator_id);
create index idx_chapters_active on public.chapters(active);
-- Now add foreign key from users.chapter_id
alter table public.users 
  add constraint fk_users_chapter 
  foreign key (chapter_id) references public.chapters(id) on delete set null;
-- ─── CHAPTER MEMBERS (additional coordinators) ────────────────────
create table public.chapter_coordinators (
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'coordinator' check (role in ('coordinator', 'viewer')),
  added_by uuid references public.users(id),
  added_at timestamptz not null default now(),
  primary key (chapter_id, user_id)
);
-- ─── SUPERVISOR WHITELIST (institutional tier feature) ────────────
-- Pre-approved supervisors for an institution
create table public.supervisor_whitelist (
  id uuid primary key default uuid_generate_v4(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  name text not null,
  email text,
  email_lower text generated always as (lower(email)) stored,
  phone text,
  org_id uuid references public.organizations(id),
  added_by uuid not null references public.users(id),
  added_at timestamptz not null default now(),
  
  check (email is not null or phone is not null)
);
create index idx_whitelist_chapter on public.supervisor_whitelist(chapter_id);
create index idx_whitelist_email on public.supervisor_whitelist(email_lower) where email is not null;
create index idx_whitelist_phone on public.supervisor_whitelist(phone) where phone is not null;
-- ─── CHAPTER INVITES ──────────────────────────────────────────────
create table public.chapter_invites (
  id uuid primary key default uuid_generate_v4(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  email text not null,
  email_lower text generated always as (lower(email)) stored,
  invited_by uuid not null references public.users(id),
  invite_token text unique not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index idx_invites_token on public.chapter_invites(invite_token);
create index idx_invites_chapter on public.chapter_invites(chapter_id);
```






### `migrations/008_notifications.sql` ⭐ NEW



```sql
-- ─── NOTIFICATIONS (in-app) ───────────────────────────────────────
create table public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in (
    'verification_received',
    'verification_disputed',
    'verification_reminder',
    'goal_milestone',
    'goal_achieved',
    'plan_changed',
    'invite_received',
    'system_announcement'
  )),
  title text not null,
  body text not null,
  action_url text,
  metadata jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_user_unread on public.notifications(user_id, created_at desc) 
  where read_at is null;
create index idx_notifications_user on public.notifications(user_id, created_at desc);
```






### `migrations/003_rls_policies.sql`
Row-level security ensures users can only read their own data.



```sql
-- Enable RLS on all user-facing tables
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.verifications enable row level security;
alter table public.organizations enable row level security;
alter table public.rate_limits enable row level security;
alter table public.notifications enable row level security;
alter table public.subscriptions enable row level security;
alter table public.invoices enable row level security;
alter table public.chapters enable row level security;
alter table public.supervisor_whitelist enable row level security;
-- Users: read/update only own row
create policy "Users can read own profile" on public.users
  for select using (auth.uid() = id);
create policy "Users can update own profile" on public.users
  for update using (auth.uid() = id);
-- Sessions: read/write only own
create policy "Users can manage own sessions" on public.sessions
  for all using (auth.uid() = user_id);
-- Verifications: read only own (via session)
create policy "Users can read own verifications" on public.verifications
  for select using (
    exists (select 1 from public.sessions where sessions.id = verifications.session_id and sessions.user_id = auth.uid())
  );
-- Organizations: anyone can read
create policy "Anyone can read organizations" on public.organizations
  for select using (true);
-- Rate limits: only own
create policy "Users can read own rate limits" on public.rate_limits
  for select using (auth.uid() = user_id);
-- Notifications: only own
create policy "Users can read own notifications" on public.notifications
  for select using (auth.uid() = user_id);
create policy "Users can update own notifications" on public.notifications
  for update using (auth.uid() = user_id);
-- Subscriptions: only own
create policy "Users can read own subscriptions" on public.subscriptions
  for select using (auth.uid() = user_id);
-- Invoices: only own
create policy "Users can read own invoices" on public.invoices
  for select using (auth.uid() = user_id);
-- Chapters: coordinators can read their chapter
create policy "Coordinators can read own chapter" on public.chapters
  for select using (
    primary_coordinator_id = auth.uid() 
    or exists (select 1 from public.chapter_coordinators where chapter_id = chapters.id and user_id = auth.uid())
    or exists (select 1 from public.users where users.id = auth.uid() and users.chapter_id = chapters.id)
  );
-- Supervisor whitelist: coordinators only
create policy "Coordinators can manage whitelist" on public.supervisor_whitelist
  for all using (
    exists (select 1 from public.chapters where chapters.id = supervisor_whitelist.chapter_id and chapters.primary_coordinator_id = auth.uid())
    or exists (select 1 from public.chapter_coordinators where chapter_id = supervisor_whitelist.chapter_id and user_id = auth.uid())
  );
```






---
## 6. Environment Variables
Create `.env.example` in the repo root. Never commit `.env`.



```bash
# ─── App ──────────────────────────────────────────────────────────
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000
API_BASE_URL=http://localhost:3001
# ─── Supabase ─────────────────────────────────────────────────────
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # Server-only, bypasses RLS
SUPABASE_JWT_SECRET=
SUPABASE_PROJECT_ID=
# ─── Twilio ───────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGING_SERVICE_SID=
TWILIO_WEBHOOK_AUTH_TOKEN=
# ─── Resend ───────────────────────────────────────────────────────
RESEND_API_KEY=
RESEND_FROM_EMAIL=hello@merit.app
RESEND_FROM_NAME=Merit
RESEND_REPLY_TO=support@merit.app
# ─── Stripe ───────────────────────────────────────────────────────
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO_MONTHLY=        # price_xxx
STRIPE_PRICE_PRO_YEARLY=
STRIPE_PRICE_PREMIUM_MONTHLY=
STRIPE_PRICE_PREMIUM_YEARLY=
STRIPE_PRICE_INSTITUTIONAL=
STRIPE_TAX_ENABLED=true
# ─── Sentry ───────────────────────────────────────────────────────
SENTRY_DSN=
SENTRY_ENVIRONMENT=development
SENTRY_TRACES_SAMPLE_RATE=0.1
# ─── PostHog ──────────────────────────────────────────────────────
POSTHOG_API_KEY=
POSTHOG_HOST=https://us.i.posthog.com
# ─── Redis (for BullMQ) ───────────────────────────────────────────
REDIS_URL=redis://localhost:6379
# ─── ProPublica (no auth required) ────────────────────────────────
PROPUBLICA_API_BASE=https://projects.propublica.org/nonprofits/api/v2
# ─── Security ─────────────────────────────────────────────────────
COOKIE_SECRET=                 # Generate with: openssl rand -base64 32
MAGIC_LINK_SECRET=             # Generate with: openssl rand -base64 32
ALLOWED_ORIGINS=http://localhost:3000,https://merit-frontend-nine.vercel.app
# ─── Feature flags ────────────────────────────────────────────────
ENABLE_FRAUD_SCAN=true
ENABLE_TRUST_SCORE_REFRESH=true
ENABLE_WEEKLY_DIGEST=true
ENABLE_DATA_RETENTION_JOB=true
```






**Mock mode behavior:** When any third-party credential is missing, the corresponding service falls back to a mock implementation. The backend works completely without any credentials — perfect for local development.
---
## 7. API Routes — Complete Reference
Every route returns JSON. Standard response shapes:
**Success:**



```json
{ "data": { ... } }
```






**Success with pagination:**



```json
{ "data": [...], "meta": { "total": 47, "page": 1, "perPage": 20, "hasMore": true } }
```






**Error:**



```json
{ "error": "error_code", "message": "Human-readable message", "details": {} }
```






Every response includes `X-Request-ID` header for tracing.
### Auth routes (`/auth/*`)
#### `POST /auth/signup`
Creates a new user account with age verification and password strength check.
**Request:**



```ts
{
  email: string,                  // valid email
  password: string,               // min 8 chars, zxcvbn score >= 3
  name: string,                   // 1-100 chars
  dateOfBirth: string,            // ISO date "YYYY-MM-DD"
  school?: string,
  grade?: number,                 // 6-12
  goalProgram?: 'NHS' | 'IB' | 'graduation' | 'scholarship' | 'personal' | 'other',
  goalHours?: number,
  marketingConsent?: boolean,     // CASL: explicit opt-in required for marketing
  parentEmail?: string            // Required if age 13-17 (COPPA-adjacent)
}
```






**Logic:**
1. IP rate-limit: 5 signups/hour per IP
2. Validate input with Zod
3. Check password strength with zxcvbn (score >= 3 required)
4. Calculate age from dateOfBirth
5. If age < 13, return `403 age_restricted`
6. If age 13-17 and no parentEmail, return `400 parental_email_required`
7. Determine age_tier: `under_13` (blocked), `minor` (13-17), `adult` (18+)
8. Check email isn't already registered
9. Create Supabase auth user (sends confirmation email automatically)
10. Insert app user row in `public.users`
11. If minor: send parental consent email to parentEmail
12. Send welcome/confirmation email via Resend
13. Log `signup` event to PostHog
14. Return user (without password)
**Response 201:**



```ts
{ 
  data: { 
    user: User, 
    requiresEmailConfirmation: true,
    requiresParentalConsent: boolean
  } 
}
```






#### `POST /auth/login`
**Request:** `{ email, password }`
**Logic:**
1. IP rate-limit: 10 logins/hour per IP
2. Check account_locked_until — if set and not expired, return `423 account_locked`
3. Call `supabase.auth.signInWithPassword(...)`
4. If failed: increment `failed_login_attempts`. After 5 failures, lock for 15 minutes.
5. If successful: reset `failed_login_attempts` to 0, return session JWT
6. Log to audit_log
**Response 200:**



```ts
{ data: { user, session: { accessToken, refreshToken, expiresAt } } }
```






#### `POST /auth/logout`
Invalidates session.
#### `POST /auth/refresh`
Exchanges refresh token for new access token.
#### `POST /auth/request-password-reset`
**Request:** `{ email }`
**Logic:** IP rate-limit 3/hour. Triggers Supabase password reset email. Always returns 200 (don't leak whether email exists).
#### `POST /auth/reset-password`
**Request:** `{ token, newPassword }`
**Logic:** Verify token, check password strength, update via Supabase Auth.
#### `POST /auth/confirm-email`
**Request:** `{ token }`
Sets `email_confirmed=true` and `email_confirmed_at=now()`.
#### `POST /auth/resend-confirmation`
**Request:** `{ email }`
IP rate-limit 3/hour. Resends confirmation email.
#### `GET /auth/me`
Returns the currently authenticated user with their plan details and chapter info.
#### `POST /auth/parental-consent`
**Request:** `{ token, consent: boolean, parentName: string }`
Parent clicks link from email, confirms consent. Updates user's `parental_consent_received=true`.
---
### Sessions routes (`/sessions/*`) — all require auth
#### `GET /sessions`
**Query:**



```ts
{
  status?: 'pending' | 'verified' | 'disputed' | 'expired',
  verificationTier?: 'unverified' | 'verified_basic' | 'verified_institutional',
  orgId?: string,
  from?: string,
  to?: string,
  page?: number,
  perPage?: number  // max 200
}
```






#### `GET /sessions/:id`
#### `POST /sessions`
**Request:**



```ts
{
  orgId?: string,
  newOrg?: { name: string, city?: string, state?: string, website?: string },
  date: string,
  hours: number,
  activity: string,
  supervisorName: string,
  supervisorPhone?: string,
  supervisorEmail?: string  // Must provide phone OR email (or both)
}
```






**Logic:**
1. Validate; must have phone OR email
2. Normalize phone to E.164, normalize email to lowercase
3. Resolve org (existing or new — search ProPublica if newOrg)
4. **Resolve or create authenticator** (see Trust System):
   - Look up by email_lower first, then phone
   - If new: create with tier determined by domain analysis
   - If existing: link to this session
5. Run fraud check (velocity, duplicate supervisor patterns)
6. Insert session with `status='pending'`, fraud_score from check
7. If supervisorPhone provided: queue SMS verification
8. If supervisorEmail provided: queue email magic link verification
9. Return session
#### `PATCH /sessions/:id`
Update editable fields: `activity`, `supervisorName`, `supervisorPhone`, `supervisorEmail`.
If contact info changes, the previous authenticator link stays but a new verification can be triggered.
#### `DELETE /sessions/:id`
Soft-delete (set `deleted_at`). Cascade-soft-deletes verifications.
#### `POST /sessions/:id/resend-verification`
Re-trigger verification. Checks rate limit. Increments `reminder_count`. Plan-gated: free=2 reminders max, pro=5, premium=unlimited.
---
### Organizations routes (`/organizations/*`)
#### `GET /organizations/search?q=...`
**Query:** `q` (min 2 chars), `limit` (max 25)
**Logic:**
1. Search local cache first (Postgres full-text on name + trigram)
2. If <5 results, query ProPublica
3. Merge and dedupe by EIN
4. Return with trust signals
**Response:**



```ts
{
  data: Array<{
    id: string,
    name: string,
    ein?: string,
    city?: string,
    state?: string,
    category?: string,
    website?: string,
    isRegisteredNonprofit: boolean,
    isInstitutionalPartner: boolean,
    trustScore: number,
    source: 'cache' | 'propublica'
  }>
}
```






#### `GET /organizations/:id`
#### `GET /organizations/me`
Orgs the user has logged hours at, with stats: totalHours, sessionCount, lastVisited, percentVerified.
#### `POST /organizations` (auth required, admin/coordinator only)
Manually add an organization (institutional coordinators only).
---
### Verifications routes (`/verifications/*`)
#### `GET /verifications/:sessionId`
Verification history for a session.
#### `POST /verifications/confirm-magic-link`
**Request:** `{ token }`
Used when supervisor clicks magic link in email. Marks verification as YES.
---
### Users routes (`/users/*`) — all require auth
#### `GET /users/me`
#### `PATCH /users/me`
Allowed fields: `name`, `school`, `grade`, `graduationYear`, `phone`, `goalProgram`, `goalHours`, `notifications`, `marketingConsent`.
#### `DELETE /users/me`
Schedules account deletion for 30 days out (`deletion_scheduled_for`). User can cancel by logging in. After 30 days, background job hard-deletes.
#### `POST /users/me/cancel-deletion`
Cancels pending deletion.
#### `GET /users/me/export`
Returns JSON dump of all user data (GDPR/PIPEDA right to portability).
---
### Stats routes (`/stats/*`) — all require auth ⭐ NEW
#### `GET /stats/dashboard`
**Response:**



```ts
{
  data: {
    totalHours: number,
    verifiedHours: number,
    pendingHours: number,
    goalHours: number,
    percentToGoal: number,
    sessionsThisWeek: number,
    streak: number,            // consecutive weeks with at least one session
    lastSession: SessionSummary | null
  }
}
```






#### `GET /stats/weekly?weeks=8`
Returns 8 weeks of hours data for the bar chart.
**Response:**



```ts
{
  data: Array<{
    weekStart: string,    // ISO date
    hours: number,
    sessionCount: number,
    verifiedCount: number
  }>
}
```






#### `GET /stats/by-org`
Hours grouped by organization (for pie chart).
#### `GET /stats/by-month?year=2026`
Monthly breakdown for the year.
---
### Notifications routes (`/notifications/*`) — all require auth ⭐ NEW
#### `GET /notifications?unreadOnly=true&limit=20`
Returns notifications, newest first.
#### `PATCH /notifications/:id/read`
Marks one as read.
#### `POST /notifications/mark-all-read`
#### `DELETE /notifications/:id`
---
### Billing routes (`/billing/*`) — all require auth ⭐ NEW
#### `POST /billing/create-checkout`
**Request:**



```ts
{
  plan: 'pro' | 'premium',
  interval: 'monthly' | 'yearly',
  successUrl: string,
  cancelUrl: string
}
```






**Logic:**
1. Create or retrieve Stripe customer (`stripe_customer_id` on user)
2. Create Stripe Checkout session
3. Return `{ checkoutUrl }`
#### `POST /billing/create-portal`
Opens Stripe Customer Portal for managing subscription (update payment method, cancel, view invoices).
**Response:** `{ data: { portalUrl } }`
#### `GET /billing/subscription`
Current subscription status, plan, renewal date.
#### `GET /billing/invoices?limit=10`
Last N invoices.
#### `POST /billing/cancel`
**Request:** `{ atPeriodEnd: boolean }`
If `atPeriodEnd=true`, sets `cancel_at_period_end`. Otherwise cancels immediately.
#### `POST /billing/reactivate`
Removes `cancel_at_period_end` flag.
---
### Admin routes (`/admin/*`) — require institutional role ⭐ NEW
All routes require user.role IN ('coordinator', 'admin') AND user belongs to a chapter.
#### `GET /admin/chapter`
Returns chapter info, member count, total hours logged.
#### `PATCH /admin/chapter`
Update chapter info: name, branding (logo, color), contact info.
#### `GET /admin/members?page=1&perPage=50`
List chapter members with their progress.
**Response:**



```ts
{
  data: Array<{
    id, name, email, grade, graduationYear,
    totalHours, verifiedHours, goalHours,
    percentToGoal,
    lastActiveAt,
    sessionCount
  }>,
  meta: { total, page, perPage }
}
```






#### `GET /admin/members/:id/sessions`
View a specific member's sessions (auditing).
#### `POST /admin/members/invite`
**Request:** `{ emails: string[] }`
Sends institutional invite emails. Each generates a token; recipient signs up via the link and gets auto-linked to the chapter.
#### `DELETE /admin/members/:id`
Remove a student from the chapter (does NOT delete their account, just unlinks).
#### `GET /admin/supervisors/whitelist`
List whitelisted supervisors.
#### `POST /admin/supervisors/whitelist`
**Request:** `{ name, email?, phone?, orgId? }`
Adds a supervisor to the whitelist. Future sessions logged with this supervisor auto-verify as `verified_institutional`.
#### `DELETE /admin/supervisors/whitelist/:id`
#### `GET /admin/reports/grant`
Generates grant report PDF (all chapter hours by org, by member, by date range).
**Request query:** `from`, `to`, `groupBy: 'org' | 'member' | 'month'`
#### `GET /admin/reports/export`
CSV export of all chapter data for the year.
---
### Exports routes (`/exports/*`)
#### `POST /exports/pdf`
**Request:**



```ts
{
  template: 'classic' | 'modern' | 'nhs-formal',
  includeOptions: {
    coverPage: boolean,
    summaryStats: boolean,
    fullSessionLog: boolean,
    verificationDetails: boolean,
    supervisorSignatures: boolean,
    chapterBranding?: boolean  // Institutional only
  },
  timeRange: 'all' | 'school-year' | 'custom',
  customFrom?: string,
  customTo?: string
}
```






**Plan gating:**
- Free: `classic` only, no branding
- Pro: `classic` + `modern`
- Premium: all templates
- Institutional: all + custom chapter branding
**Response:** Signed Supabase Storage URL valid 1 hour.
---
### Magic Link routes (`/magic/*`) ⭐ NEW
For passwordless supervisor verification (email channel).
#### `GET /magic/verify?token=...`
Supervisor clicks link from verification email. Marks session as verified.
#### `POST /magic/supervisor-login`
**Request:** `{ email }`
Sends a magic link to the supervisor so they can view all their verifications in a minimal dashboard. (No account creation needed.)
---
### Webhook routes (`/webhooks/*`) — no auth, signature-verified
#### `POST /webhooks/twilio/inbound`
Handles SMS replies (YES/NO/STOP).
**Logic:**
1. Verify Twilio signature
2. Parse body
3. If STOP: add to `sms_opt_outs`
4. If YES/NO: find latest unanswered verification by phone, update
5. If YES: set session status='verified', verification_tier per authenticator tier (see Trust System §9)
6. Send confirmation reply
7. Create notification for the student
8. Update authenticator stats (increment successful_verifications)
9. Trigger trust score recalculation for org domain
#### `POST /webhooks/stripe`
Handles Stripe subscription events.
**Events to handle:**
- `checkout.session.completed` → activate subscription
- `customer.subscription.updated` → sync status
- `customer.subscription.deleted` → downgrade to free
- `invoice.paid` → record invoice, send receipt
- `invoice.payment_failed` → notify user, start grace period
**Idempotency:** Insert into `stripe_events` with the event ID. If insert fails (unique violation), skip processing — already handled.
#### `POST /webhooks/resend`
Handles email bounces and complaints. Auto-adds to `email_opt_outs`.
---
### Health route
#### `GET /health`



```ts
{
  status: 'ok',
  uptime: number,
  mode: {
    supabase: 'mock' | 'real',
    twilio: 'mock' | 'real',
    resend: 'mock' | 'real',
    stripe: 'mock' | 'real'
  },
  version: string,
  timestamp: string
}
```






#### `GET /health/ready`
Returns 200 only if all real-mode services are reachable (deep health check). Used by Railway.
---
## 8. Authentication & Account Security
### Signup
1. Frontend → `POST /auth/signup` with form data + IP
2. Backend: validate Zod, check IP rate limit (5/hour)
3. Check password strength: zxcvbn score must be >= 3
4. Compute age from DOB
5. If age < 13: return 403
6. If age 13-17: require parentEmail field
7. `supabase.auth.signUp(...)` creates auth.users row, sends confirmation email
8. Insert public.users row with is_minor flag and parental consent fields
9. If minor: queue parental consent email
10. Queue welcome email
11. Log signup event to PostHog
12. Return user
### Login
1. Frontend → `POST /auth/login`
2. Backend: IP rate-limit 10/hour
3. Check `account_locked_until` — if set and future, return 423
4. `supabase.auth.signInWithPassword(...)`
5. On failure: increment `failed_login_attempts`. At 5 failures, set `account_locked_until = now() + 15 minutes`.
6. On success: reset counter, return session
### Account lockout
- 5 failed attempts → 15-minute lock
- 10 failed attempts within 24h → 24-hour lock + email user a security alert
- Logged in audit_log
### Password requirements
- Minimum 8 characters
- zxcvbn score >= 3 (resistant to dictionary attacks)
- Cannot equal email
- Frontend validates on type, backend re-validates on submit



```typescript
// lib/password.ts
import { zxcvbnAsync } from '@zxcvbn-ts/core'
export async function checkPasswordStrength(password: string, userInputs: string[] = []) {
  const result = await zxcvbnAsync(password, userInputs)
  return {
    score: result.score,           // 0-4
    feedback: result.feedback,     // warning + suggestions
    isStrong: result.score >= 3
  }
}
```






### JWT verification middleware



```typescript
// middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import { UnauthorizedError } from '../lib/errors'
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError()
  }
  
  const token = authHeader.slice(7)
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  
  if (error || !data.user) {
    throw new UnauthorizedError()
  }
  
  // Load app user row
  const { data: appUser } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', data.user.id)
    .is('deleted_at', null)
    .single()
  
  if (!appUser) {
    throw new UnauthorizedError()
  }
  
  // Check email confirmation for protected actions
  if (!appUser.email_confirmed && !req.path.startsWith('/auth/resend-confirmation')) {
    throw new AppError('email_not_confirmed', 'Please confirm your email first', 403)
  }
  
  req.user = appUser
  req.authUser = data.user
  next()
}
```






### Role-based access middleware



```typescript
// middleware/role.middleware.ts
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError('forbidden', 'Insufficient permissions', 403)
    }
    next()
  }
}
// Usage:
// router.get('/admin/members', requireAuth, requireRole('coordinator', 'admin'), handler)
```






### Magic link (passwordless) flow
For supervisors who want to confirm via email instead of SMS:
1. Verification email contains a link: `https://merit.app/verify?token=xxx`
2. Token is stored in `verifications.confirmation_token`, expires in 7 days
3. When supervisor clicks: `GET /magic/verify?token=xxx`
4. Verify token, mark session verified, redirect to "Thanks" page
5. Supervisor optionally enters their email to access a dashboard of all their verifications
---
## 9. Trust & Verification System (Core Differentiator) ⭐
This is what makes Merit's verification claims meaningful. **The fraud system isn't a single check — it's a layered trust model where multiple signals combine.**
### The Two-Tier Authenticator Model
Every supervisor (authenticator) gets classified into one of four tiers based on their contact info:
| Tier | Trigger | Verification Badge Awarded |
|------|---------|----------------------------|
| `unverified` | Only phone, no email | Hours pending until reply |
| `personal_email` | Email at known personal domain (gmail, yahoo, etc.) | "Verified Hours" |
| `org_email_unverified` | Email at custom domain, but domain not yet trusted | "Verified Hours" |
| `org_email_verified` | Email at trusted domain (network effect OR domain match) | "Verified Hours + Verified Authenticator" ⭐ |
### Domain Trust Calculation
A domain becomes trusted (`org_email_verified`) when:
1. **Network effect:** ≥3 unique authenticators using that domain have verified hours, OR
2. **Domain match:** The domain matches the organization's website domain (e.g., `vancouverfood.ca` matches `vancouverfood.ca` website), OR
3. **Institutional whitelist:** Domain is registered by an institutional coordinator, OR
4. **Manual verification:** Admin has manually verified it
Trust score formula:



```
trust_score = min(1.0, 
  0.3 * (matches_org_website ? 1 : 0) +
  0.3 * (matches_propublica_ein_holder ? 1 : 0) +
  0.3 * (manually_verified ? 1 : 0) +
  0.2 * min(1.0, unique_authenticator_count / 5) +
  0.1 * (successful_verification_count / max(1, total_verification_count))
)
If manually_blocked: trust_score = 0
```






A domain is "verified" when `trust_score >= 0.5` AND `domain_type IN ('org_unverified', 'org_verified', 'institutional')`.
### Session Verification Tier (the badge shown on the PDF)



```
if session.status != 'verified': 
  verification_tier = null
else if authenticator.tier == 'org_email_verified' OR institutional_whitelist:
  verification_tier = 'verified_institutional'
else:
  verification_tier = 'verified_basic'
```






### Implementation: `services/trust.service.ts`



```typescript
import { supabaseAdmin } from '../config/supabase'
import { extractEmailDomain, isPersonalDomain } from '../lib/email-domain'
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.ca',
  'hotmail.com', 'hotmail.ca', 'outlook.com', 'live.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com'
])
export async function resolveOrCreateAuthenticator(input: {
  name: string
  email?: string
  phone?: string
  orgId?: string
}) {
  // 1. Try to find existing authenticator by email, then phone
  let authenticator = null
  
  if (input.email) {
    const { data } = await supabaseAdmin
      .from('authenticators')
      .select('*')
      .eq('email_lower', input.email.toLowerCase())
      .maybeSingle()
    authenticator = data
  }
  
  if (!authenticator && input.phone) {
    const { data } = await supabaseAdmin
      .from('authenticators')
      .select('*')
      .eq('phone', input.phone)
      .maybeSingle()
    authenticator = data
  }
  
  // 2. Determine tier
  const tier = await classifyAuthenticatorTier(input)
  
  // 3. Create or update
  if (!authenticator) {
    const { data } = await supabaseAdmin
      .from('authenticators')
      .insert({
        name: input.name,
        email: input.email,
        phone: input.phone,
        org_id: input.orgId,
        tier
      })
      .select()
      .single()
    authenticator = data
  } else if (authenticator.tier !== tier) {
    // Tier may have changed (e.g., domain became trusted)
    await supabaseAdmin
      .from('authenticators')
      .update({ tier })
      .eq('id', authenticator.id)
    authenticator.tier = tier
  }
  
  // 4. Touch the domain record
  if (input.email) {
    await touchEmailDomain(input.email, input.orgId)
  }
  
  return authenticator
}
async function classifyAuthenticatorTier(input: {
  email?: string
  phone?: string
  orgId?: string
}): Promise<string> {
  if (!input.email) return 'unverified'
  
  const domain = extractEmailDomain(input.email)
  if (!domain) return 'unverified'
  
  // Personal domain check
  if (PERSONAL_DOMAINS.has(domain)) return 'personal_email'
  
  // Look up domain trust
  const { data: domainRecord } = await supabaseAdmin
    .from('org_email_domains')
    .select('*')
    .eq('domain', domain)
    .maybeSingle()
  
  if (!domainRecord) {
    // New domain — start as unverified
    return 'org_email_unverified'
  }
  
  if (domainRecord.manually_blocked) return 'unverified'
  if (domainRecord.domain_type === 'personal') return 'personal_email'
  if (domainRecord.trust_score >= 0.5) return 'org_email_verified'
  
  return 'org_email_unverified'
}
async function touchEmailDomain(email: string, orgId?: string) {
  const domain = extractEmailDomain(email)
  if (!domain) return
  
  const { data: existing } = await supabaseAdmin
    .from('org_email_domains')
    .select('*')
    .eq('domain', domain)
    .maybeSingle()
  
  if (!existing) {
    // First time seeing this domain
    const domainType = PERSONAL_DOMAINS.has(domain) ? 'personal' : 'org_unverified'
    await supabaseAdmin.from('org_email_domains').insert({
      domain,
      org_id: orgId,
      domain_type: domainType,
      trust_score: domainType === 'personal' ? 0.1 : 0.0,
      first_seen_at: new Date()
    })
  } else {
    await supabaseAdmin
      .from('org_email_domains')
      .update({ last_seen_at: new Date() })
      .eq('id', existing.id)
  }
}
export async function recalculateDomainTrust(domain: string) {
  const { data: domainRecord } = await supabaseAdmin
    .from('org_email_domains')
    .select('*')
    .eq('domain', domain)
    .single()
  
  if (!domainRecord || domainRecord.manually_blocked) return
  
  // Count unique authenticators on this domain
  const { count: uniqueAuths } = await supabaseAdmin
    .from('authenticators')
    .select('id', { count: 'exact', head: true })
    .eq('email_domain', domain)
  
  // Count successful verifications on this domain
  const { data: stats } = await supabaseAdmin.rpc('domain_verification_stats', { 
    p_domain: domain 
  })
  
  const successCount = stats?.success_count ?? 0
  const totalCount = stats?.total_count ?? 0
  
  // Domain ↔ org website match
  let matchesWebsite = false
  if (domainRecord.org_id) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('website_domain')
      .eq('id', domainRecord.org_id)
      .single()
    matchesWebsite = org?.website_domain === domain
  }
  
  // Compute trust score
  const trustScore = Math.min(1.0,
    0.3 * (matchesWebsite ? 1 : 0) +
    0.3 * (domainRecord.matches_propublica_ein_holder ? 1 : 0) +
    0.3 * (domainRecord.manually_verified ? 1 : 0) +
    0.2 * Math.min(1.0, (uniqueAuths ?? 0) / 5) +
    0.1 * (totalCount > 0 ? successCount / totalCount : 0)
  )
  
  await supabaseAdmin
    .from('org_email_domains')
    .update({
      unique_authenticator_count: uniqueAuths ?? 0,
      successful_verification_count: successCount,
      trust_score: trustScore,
      matches_org_website: matchesWebsite,
      trust_score_updated_at: new Date(),
      domain_type: trustScore >= 0.5 ? 'org_verified' : 'org_unverified'
    })
    .eq('id', domainRecord.id)
}
```






### Implementation: `services/fraud.service.ts`



```typescript
export async function calculateFraudScore(session: {
  user_id: string
  org_id: string
  date: string
  hours: number
  supervisor_phone?: string
  supervisor_email?: string
}): Promise<{ score: number; flags: string[] }> {
  const flags: string[] = []
  let score = 0
  
  // 1. Velocity: too many sessions in one day
  const { count: sameDay } = await supabaseAdmin
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.user_id)
    .eq('date', session.date)
    .is('deleted_at', null)
  
  if ((sameDay ?? 0) >= 3) {
    flags.push('velocity_same_day')
    score += 0.2
  }
  
  // 2. Total hours that day exceed reasonable (>16h)
  const { data: dayHours } = await supabaseAdmin
    .from('sessions')
    .select('hours')
    .eq('user_id', session.user_id)
    .eq('date', session.date)
    .is('deleted_at', null)
  
  const totalDayHours = (dayHours ?? []).reduce((sum, s) => sum + Number(s.hours), 0) + session.hours
  if (totalDayHours > 16) {
    flags.push('impossible_hours')
    score += 0.4
  }
  
  // 3. Same supervisor across many unrelated orgs (could be friend-as-supervisor)
  if (session.supervisor_phone) {
    const { data: supervisorOrgs } = await supabaseAdmin
      .from('sessions')
      .select('org_id')
      .eq('user_id', session.user_id)
      .or(`supervisor_phone.eq.${session.supervisor_phone}`)
      .is('deleted_at', null)
    
    const uniqueOrgs = new Set((supervisorOrgs ?? []).map(s => s.org_id))
    if (uniqueOrgs.size > 3) {
      flags.push('supervisor_too_many_orgs')
      score += 0.2
    }
  }
  
  // 4. Future-dated session
  const sessionDate = new Date(session.date)
  if (sessionDate > new Date()) {
    flags.push('future_date')
    score += 0.5
  }
  
  // 5. Very old session (>1 year)
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  if (sessionDate < oneYearAgo) {
    flags.push('very_old_session')
    score += 0.1
  }
  
  // 6. Round number suspicion (always 8.0 hours exactly)
  if (Number(session.hours) % 1 === 0 && Number(session.hours) >= 6) {
    // Check if user always logs round numbers
    const { data: recentSessions } = await supabaseAdmin
      .from('sessions')
      .select('hours')
      .eq('user_id', session.user_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10)
    
    const allRound = (recentSessions ?? []).every(s => Number(s.hours) % 1 === 0)
    if (allRound && (recentSessions ?? []).length >= 5) {
      flags.push('always_round_numbers')
      score += 0.05  // Weak signal
    }
  }
  
  return { score: Math.min(1.0, score), flags }
}
```






Sessions with `fraud_score > 0.7` are flagged for manual review. Admin users (Kai) can review at `/admin/review-queue`.
---
## 10. SMS Verification System
### Sending an SMS



```typescript
// services/verifications.service.ts
import { twilioService } from './twilio.service'
import { checkRateLimit, incrementRateLimit } from './rate-limit.service'
import { resolveOrCreateAuthenticator } from './trust.service'
export async function sendVerificationSMS(session: Session, user: User) {
  // 1. Check supervisor hasn't opted out
  const { data: optedOut } = await supabaseAdmin
    .from('sms_opt_outs')
    .select('phone')
    .eq('phone', session.supervisor_phone)
    .maybeSingle()
  
  if (optedOut) {
    throw new AppError('SUPERVISOR_OPTED_OUT', 'This supervisor opted out of SMS. They can verify via email instead.')
  }
  
  // 2. Check rate limit per plan
  const limits = { free: 3, pro: 15, premium: 999, institutional: 999 }
  const max = limits[user.plan] ?? 3
  const limit = await checkRateLimit(user.id, 'sms_send', max)
  
  if (!limit.allowed) {
    throw new AppError(
      'RATE_LIMIT_EXCEEDED',
      `You've used your ${max} daily verifications. Upgrade your plan for more.`,
      429
    )
  }
  
  // 3. Format the message
  const message = formatVerificationSMS({
    supervisorName: session.supervisor_name,
    studentName: user.name,
    hours: session.hours,
    orgName: session.org.name,
    date: session.date
  })
  
  // 4. Send via Twilio
  const result = await twilioService.sendSms({
    to: session.supervisor_phone,
    body: message
  })
  
  // 5. Record the verification attempt
  await supabaseAdmin.from('verifications').insert({
    session_id: session.id,
    channel: 'sms',
    destination: session.supervisor_phone,
    twilio_sid: result.sid,
    sent_at: new Date()
  })
  
  // 6. Increment rate limit
  await incrementRateLimit(user.id, 'sms_send')
  
  // 7. Track
  analytics.track(user.id, 'verification_sent', {
    sessionId: session.id,
    channel: 'sms'
  })
  
  return result
}
```






### Receiving a Response
`POST /webhooks/twilio/inbound` flow:
1. Verify Twilio signature via `TWILIO_WEBHOOK_AUTH_TOKEN`
2. Parse `From` and `Body`
3. Normalize body: uppercase, trim
4. Look up most recent unanswered verification for this phone (within last 14 days)
Handle responses:
**STOP:**
- Insert into `sms_opt_outs`
- Reply: "You've been unsubscribed. Reply START to opt back in."
**YES:**
- Find authenticator by phone
- Compute verification_tier based on authenticator.tier:
  - `org_email_verified` → 'verified_institutional'
  - else → 'verified_basic'
- Update session: status='verified', verification_tier, verified_at, verified_by=authenticator.name
- Increment authenticator stats
- Trigger trust score recalc (queued job)
- Create notification for student
- Reply: "Thanks — verification recorded for {studentName}'s {hours} hours at {orgName}."
**NO:**
- Update session: status='disputed', verified_at
- Create notification for student (urgent)
- Reply: "Verification declined. The student has been notified. If this was an error, reply YES."
**Anything else:**
- Reply: "Sorry, I didn't understand. Reply YES to verify, NO to dispute, or STOP to opt out."
### Reminders (cron job)
Daily at 10am PT, find unanswered verifications:
- Sent ≥24 hours ago
- No response
- `reminder_count < max_reminders_for_plan`
Send reminder SMS, increment counter.
---
## 11. Email System & Templates
All transactional emails are React Email components in `src/templates/emails/`. Resend renders them.
### Template: Email Confirmation



```tsx
// src/templates/emails/confirm-email.tsx
import { Html, Body, Container, Heading, Text, Button, Hr, Link } from '@react-email/components'
export function ConfirmEmail({ name, confirmationUrl }: { name: string; confirmationUrl: string }) {
  return (
    <Html>
      <Body style={{ fontFamily: 'system-ui, sans-serif', backgroundColor: '#f5f5f5', margin: 0, padding: '40px 0' }}>
        <Container style={{ backgroundColor: '#fff', maxWidth: 560, margin: '0 auto', padding: 40, borderRadius: 8 }}>
          <Heading style={{ fontSize: 24, marginBottom: 16 }}>Welcome to Merit, {name}.</Heading>
          <Text style={{ fontSize: 16, lineHeight: 1.5, color: '#333' }}>
            You're one click away from logging your first volunteer hours. 
            Confirm your email to get started.
          </Text>
          <Button 
            href={confirmationUrl} 
            style={{ backgroundColor: '#2563eb', color: '#fff', padding: '12px 24px', borderRadius: 6, textDecoration: 'none', display: 'inline-block', marginTop: 16, marginBottom: 16 }}
          >
            Confirm email
          </Button>
          <Text style={{ fontSize: 14, color: '#666' }}>
            Or copy this link: <Link href={confirmationUrl}>{confirmationUrl}</Link>
          </Text>
          <Hr style={{ borderColor: '#e5e5e5', margin: '24px 0' }} />
          <Text style={{ fontSize: 12, color: '#999' }}>
            If you didn't sign up for Merit, you can safely ignore this email.
            — The Merit team · <Link href="https://merit.app">merit.app</Link>
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
```






### Template: Password Reset



```tsx
// src/templates/emails/password-reset.tsx
export function PasswordReset({ name, resetUrl, ipAddress, userAgent }) {
  return (
    <Html>
      <Body>
        <Container>
          <Heading>Reset your password</Heading>
          <Text>Hi {name},</Text>
          <Text>
            We received a request to reset your password. Click the button below to set a new one. 
            This link expires in 1 hour.
          </Text>
          <Button href={resetUrl}>Reset password</Button>
          <Text style={{ fontSize: 12, color: '#666' }}>
            Request came from {ipAddress} ({userAgent}). 
            If this wasn't you, ignore this email and your password stays the same.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
```






### Template: Weekly Digest



```tsx
// src/templates/emails/weekly-digest.tsx
export function WeeklyDigest({ name, hoursThisWeek, sessionsThisWeek, totalHours, goalHours, goalProgram, percentToGoal }) {
  return (
    <Html>
      <Body>
        <Container>
          <Heading>Your week in service</Heading>
          <Text>Hi {name},</Text>
          <Text>
            Last week you logged <strong>{hoursThisWeek} hours</strong> across {sessionsThisWeek} sessions.
          </Text>
          <Text>
            You're at {totalHours} / {goalHours} hours toward your {goalProgram} goal — {percentToGoal}%.
          </Text>
          {percentToGoal >= 100 ? (
            <Text style={{ color: '#16a34a', fontWeight: 'bold' }}>You hit your goal. Nice work.</Text>
          ) : (
            <Text>{goalHours - totalHours} hours to go.</Text>
          )}
          <Button href="https://merit.app/dashboard">View dashboard</Button>
        </Container>
      </Body>
    </Html>
  )
}
```






### Template: Goal Milestone



```tsx
// src/templates/emails/milestone.tsx
export function GoalMilestone({ name, milestone, totalHours, goalHours, goalProgram }) {
  const messages = {
    25: "You're a quarter of the way there.",
    50: "Halfway. You're crushing it.",
    75: "Three-quarters done. The finish line is close.",
    100: "You hit your goal."
  }
  return (
    <Html>
      <Body>
        <Container>
          <Heading>{messages[milestone]}</Heading>
          <Text>Hi {name},</Text>
          <Text>
            You've logged <strong>{totalHours} hours</strong> toward your {goalProgram} goal of {goalHours}.
          </Text>
          <Button href="https://merit.app/dashboard">See your progress</Button>
        </Container>
      </Body>
    </Html>
  )
}
```






### Template: Plan Changed



```tsx
export function PlanChanged({ name, newPlan, effectiveDate, features }) {
  return (
    <Html>
      <Body>
        <Container>
          <Heading>Welcome to Merit {capitalize(newPlan)}</Heading>
          <Text>Hi {name},</Text>
          <Text>Your plan upgrade is active as of {effectiveDate}. Here's what you've unlocked:</Text>
          <ul>{features.map(f => <li key={f}>{f}</li>)}</ul>
          <Button href="https://merit.app/dashboard">Start using your new features</Button>
        </Container>
      </Body>
    </Html>
  )
}
```






### Template: Account Deletion Confirmation



```tsx
export function AccountDeleted({ name, deletionDate, cancelUrl }) {
  return (
    <Html>
      <Body>
        <Container>
          <Heading>Your account is scheduled for deletion</Heading>
          <Text>Hi {name},</Text>
          <Text>
            You requested account deletion. Your data will be permanently removed on <strong>{deletionDate}</strong>.
          </Text>
          <Text>
            If this was a mistake, you can cancel anytime before then by clicking below:
          </Text>
          <Button href={cancelUrl}>Cancel deletion</Button>
          <Text style={{ fontSize: 12, color: '#666' }}>
            After {deletionDate}, your data cannot be recovered.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
```






### Template: Institutional Invite



```tsx
export function InstitutionalInvite({ chapterName, inviteUrl, invitedBy }) {
  return (
    <Html>
      <Body>
        <Container>
          <Heading>You're invited to join {chapterName} on Merit</Heading>
          <Text>{invitedBy} invited you to join their chapter on Merit.</Text>
          <Text>
            Merit helps students track verified volunteer hours for NHS, IB, college apps, and more.
            Sign up with this link to be auto-linked to {chapterName}.
          </Text>
          <Button href={inviteUrl}>Join {chapterName}</Button>
          <Text style={{ fontSize: 12 }}>This invite expires in 7 days.</Text>
        </Container>
      </Body>
    </Html>
  )
}
```






### Template: Supervisor Magic Link



```tsx
export function SupervisorMagicLink({ studentName, hours, orgName, date, verifyUrl }) {
  return (
    <Html>
      <Body>
        <Container>
          <Heading>Verify {studentName}'s volunteer hours</Heading>
          <Text>
            <strong>{studentName}</strong> logged <strong>{hours} hours</strong> at <strong>{orgName}</strong> on {date}.
          </Text>
          <Text>If this is accurate, click the button below to confirm.</Text>
          <Button href={verifyUrl + '&response=YES'}>Verify these hours</Button>
          <Text style={{ marginTop: 16 }}>
            If this is wrong, click here: <Link href={verifyUrl + '&response=NO'}>Dispute</Link>
          </Text>
          <Hr />
          <Text style={{ fontSize: 12, color: '#666' }}>
            This is a one-time verification. Merit will not email you again unless another student names you as a supervisor.
            <Link href={verifyUrl + '&response=STOP'}>Unsubscribe from all Merit emails</Link>
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
```






### Template: Verification Receipt (sent to student after verified)



```tsx
export function VerificationReceipt({ name, sessionDate, hours, orgName, supervisorName, tier }) {
  const tierLabel = tier === 'verified_institutional' 
    ? 'Verified Hours + Verified Authenticator ✓✓' 
    : 'Verified Hours ✓'
  return (
    <Html>
      <Body>
        <Container>
          <Heading>{supervisorName} verified your hours</Heading>
          <Text>Hi {name},</Text>
          <Text>
            <strong>{supervisorName}</strong> confirmed your {hours} hours at <strong>{orgName}</strong> on {sessionDate}.
          </Text>
          <Text>Status: <strong>{tierLabel}</strong></Text>
          <Button href="https://merit.app/sessions">View your sessions</Button>
        </Container>
      </Body>
    </Html>
  )
}
```






### Parental Consent Email (sent to parent of 13-17 user)



```tsx
export function ParentalConsent({ parentName, studentName, consentUrl }) {
  return (
    <Html>
      <Body>
        <Container>
          <Heading>Your child wants to use Merit</Heading>
          <Text>Hi{parentName ? ` ${parentName}` : ''},</Text>
          <Text>
            <strong>{studentName}</strong> signed up for Merit, a service that helps track verified volunteer hours.
          </Text>
          <Text>
            Because they're under 18, we need your consent to create an account. We collect:
          </Text>
          <ul>
            <li>Name, email, school, grade</li>
            <li>Volunteer activities your child logs</li>
            <li>Supervisor contact info (only used to verify hours via SMS or email)</li>
          </ul>
          <Text>We don't sell data, don't show ads, and your child can delete their account anytime.</Text>
          <Button href={consentUrl}>Approve account</Button>
          <Text style={{ fontSize: 12 }}>
            Full privacy policy: <Link href="https://merit.app/privacy">merit.app/privacy</Link>
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
```






### SMS Templates



```typescript
// src/templates/sms/verification.ts
export function formatVerificationSMS({ supervisorName, studentName, hours, orgName, date }) {
  return `Hi ${supervisorName}, ${studentName} logged ${hours} hours at ${orgName} on ${formatDate(date)}. Reply YES to verify, NO to dispute, STOP to opt out. — Merit`
}
// src/templates/sms/reminder.ts
export function formatReminderSMS({ supervisorName, studentName, hours, orgName }) {
  return `Reminder from Merit: ${studentName} is waiting for verification of ${hours} hours at ${orgName}. Reply YES or NO. (Reply STOP to opt out.)`
}
// src/templates/sms/opt-out-confirm.ts
export function formatOptOutConfirm() {
  return `You've been unsubscribed from Merit verifications. Reply START to opt back in.`
}
```






---
## 12. Organization Verification (ProPublica + Internal Trust)
Two signals make an org trustworthy:
1. **External:** Registered in IRS 990 database (queried via ProPublica)
2. **Internal:** Network effect — multiple verified authenticators using emails at the org's domain
### `services/propublica.service.ts`



```typescript
import { env } from '../config/env'
import { logger } from '../lib/logger'
export async function searchNonprofits(query: string, limit = 10) {
  const url = `${env.PROPUBLICA_API_BASE}/search.json?q=${encodeURIComponent(query)}`
  
  try {
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Merit/1.0 (https://merit.app)' }
    })
    
    if (!res.ok) {
      logger.warn({ query, status: res.status }, 'propublica_search_failed')
      return []
    }
    
    const data = await res.json()
    return (data.organizations ?? []).slice(0, limit).map(shapeOrganization)
  } catch (err) {
    logger.error({ err, query }, 'propublica_search_error')
    return []
  }
}
export async function getNonprofitByEin(ein: string) {
  const url = `${env.PROPUBLICA_API_BASE}/organizations/${ein}.json`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data = await res.json()
    return shapeOrganization(data.organization)
  } catch (err) {
    logger.error({ err, ein }, 'propublica_get_error')
    return null
  }
}
function shapeOrganization(raw: any) {
  return {
    name: raw.name,
    ein: raw.ein,
    city: raw.city,
    state: raw.state,
    nteeCode: raw.ntee_code,
    isRegisteredNonprofit: true,
    source: 'propublica'
  }
}
```






### Caching strategy
When a user creates a session with a new org, the search hits ProPublica. The matched org is **persisted in the local `organizations` table** with `is_registered_nonprofit=true`. Future searches hit the local cache first, ProPublica only as a fallback. After 30 days, cron job refreshes cached org data.
---
## 13. Rate Limiting (Per Plan)
| Action | Free | Pro | Premium | Institutional |
|--------|------|-----|---------|---------------|
| SMS verifications/day | 3 | 15 | unlimited | unlimited |
| Email verifications/day | 5 | 25 | unlimited | unlimited |
| Resend verification reminders | 2 per session | 5 per session | unlimited | unlimited |
| PDF exports/day | 3 | 10 | unlimited | unlimited |
| API calls/min | 60 | 120 | 240 | 480 |
IP-based limits (unauthenticated):
- Signups: 5/hour
- Logins: 10/hour
- Password reset requests: 3/hour
- Confirmation resend: 3/hour
### Implementation



```typescript
// middleware/rate-limit.middleware.ts
export function rateLimit(action: string, limits: Record<string, number>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user!
    const max = limits[user.plan] ?? limits.free
    
    if (max >= 999) return next()  // Unlimited
    
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabaseAdmin
      .from('rate_limits')
      .select('count')
      .eq('user_id', user.id)
      .eq('action', action)
      .eq('date', today)
      .maybeSingle()
    
    const current = data?.count ?? 0
    
    // Set rate limit headers (RFC 6585)
    res.setHeader('X-RateLimit-Limit', max)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - current))
    res.setHeader('X-RateLimit-Reset', getTomorrowMidnightUnix())
    
    if (current >= max) {
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message: `You've reached your ${action} limit for today.`,
        details: { 
          limit: max, 
          current, 
          plan: user.plan,
          upgradeUrl: 'https://merit.app/upgrade' 
        }
      })
    }
    
    next()
  }
}
// IP-based limiter (separate)
export function ipRateLimit(action: string, max: number, windowHours = 1) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip!
    const hour = new Date()
    hour.setMinutes(0, 0, 0)
    
    const { data } = await supabaseAdmin
      .from('ip_rate_limits')
      .upsert({ ip_address: ip, action, hour: hour.toISOString(), count: 1 }, {
        onConflict: 'ip_address,action,hour',
        ignoreDuplicates: false
      })
      .select('count')
      .single()
    
    if ((data?.count ?? 0) > max) {
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Too many requests. Try again later.'
      })
    }
    
    next()
  }
}
```






---
## 14. Payment & Billing System (Stripe) ⭐
### Plan Definitions
| Plan | Price | Stripe Price IDs | Features |
|------|-------|------------------|----------|
| **Free** | $0 | n/a | 3 SMS/day, 50 lifetime hours, Classic PDF only |
| **Pro** | $5/mo or $35/yr | `STRIPE_PRICE_PRO_*` | 15 SMS/day, unlimited hours, Modern PDF, scholarship tracker, advanced stats |
| **Premium** | $12/mo or $89/yr | `STRIPE_PRICE_PREMIUM_*` | Unlimited SMS, all PDFs + branding, AI insights, multi-goal tracking, priority support |
| **Institutional** | $99/yr per chapter (contact sales) | `STRIPE_PRICE_INSTITUTIONAL` | Everything Premium + admin dashboard, supervisor whitelist, branded PDFs, grant reporting |
### Plan Configuration



```typescript
// config/plans.ts
export const PLAN_FEATURES = {
  free: {
    smsPerDay: 3,
    emailPerDay: 5,
    pdfTemplates: ['classic'],
    lifetimeHoursCap: 50,
    scholarshipTracker: false,
    advancedStats: false,
    aiInsights: false,
    customBranding: false,
    bulkOperations: false,
    prioritySupport: false
  },
  pro: {
    smsPerDay: 15,
    emailPerDay: 25,
    pdfTemplates: ['classic', 'modern'],
    lifetimeHoursCap: null,
    scholarshipTracker: true,
    advancedStats: true,
    aiInsights: false,
    customBranding: false,
    bulkOperations: false,
    prioritySupport: false
  },
  premium: {
    smsPerDay: null,  // unlimited
    emailPerDay: null,
    pdfTemplates: ['classic', 'modern', 'nhs-formal'],
    lifetimeHoursCap: null,
    scholarshipTracker: true,
    advancedStats: true,
    aiInsights: true,
    customBranding: true,  // user-level branding
    bulkOperations: false,
    prioritySupport: true
  },
  institutional: {
    smsPerDay: null,
    emailPerDay: null,
    pdfTemplates: ['classic', 'modern', 'nhs-formal'],
    lifetimeHoursCap: null,
    scholarshipTracker: true,
    advancedStats: true,
    aiInsights: true,
    customBranding: true,  // chapter-level branding
    bulkOperations: true,
    prioritySupport: true,
    adminDashboard: true,
    supervisorWhitelist: true,
    grantReporting: true,
    maxMembers: 100  // configurable per chapter
  }
}
```






### Plan-gating middleware



```typescript
// middleware/plan-gate.middleware.ts
export function requirePlan(...allowedPlans: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !allowedPlans.includes(req.user.plan)) {
      throw new AppError(
        'plan_required',
        `This feature requires ${allowedPlans.join(' or ')}.`,
        403,
        { currentPlan: req.user?.plan, requiredPlans: allowedPlans, upgradeUrl: '/upgrade' }
      )
    }
    next()
  }
}
export function requireFeature(feature: keyof typeof PLAN_FEATURES.free) {
  return (req: Request, res: Response, next: NextFunction) => {
    const features = PLAN_FEATURES[req.user!.plan]
    if (!features[feature]) {
      throw new AppError('feature_locked', `This feature is not available on your plan.`, 403)
    }
    next()
  }
}
```






### Stripe Service



```typescript
// services/stripe.service.ts
import Stripe from 'stripe'
import { env } from '../config/env'
const isReal = !!env.STRIPE_SECRET_KEY
export const stripe = isReal 
  ? new Stripe(env.STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.acacia' })
  : createMockStripe()
export const STRIPE_MODE = isReal ? 'real' : 'mock'
export async function createOrGetCustomer(user: User): Promise<string> {
  if (user.stripe_customer_id) return user.stripe_customer_id
  
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { user_id: user.id }
  })
  
  await supabaseAdmin
    .from('users')
    .update({ stripe_customer_id: customer.id })
    .eq('id', user.id)
  
  return customer.id
}
export async function createCheckoutSession(opts: {
  user: User
  plan: 'pro' | 'premium'
  interval: 'monthly' | 'yearly'
  successUrl: string
  cancelUrl: string
}) {
  const customerId = await createOrGetCustomer(opts.user)
  const priceId = getPriceId(opts.plan, opts.interval)
  
  return stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    automatic_tax: { enabled: env.STRIPE_TAX_ENABLED },
    subscription_data: {
      metadata: { user_id: opts.user.id, plan: opts.plan }
    }
  })
}
export async function createPortalSession(user: User, returnUrl: string) {
  const customerId = await createOrGetCustomer(user)
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl
  })
}
function getPriceId(plan: string, interval: string): string {
  const map = {
    'pro-monthly': env.STRIPE_PRICE_PRO_MONTHLY,
    'pro-yearly': env.STRIPE_PRICE_PRO_YEARLY,
    'premium-monthly': env.STRIPE_PRICE_PREMIUM_MONTHLY,
    'premium-yearly': env.STRIPE_PRICE_PREMIUM_YEARLY
  }
  return map[`${plan}-${interval}`]!
}
```






### Stripe Webhook Handler



```typescript
// routes/webhooks.routes.ts
router.post('/webhooks/stripe', 
  express.raw({ type: 'application/json' }),  // Raw body for signature verification
  async (req, res) => {
    const sig = req.headers['stripe-signature']!
    let event: Stripe.Event
    
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET!)
    } catch (err) {
      logger.error({ err }, 'stripe_webhook_signature_invalid')
      return res.status(400).send('Invalid signature')
    }
    
    // Idempotency: check if we've processed this event
    const { error: insertError } = await supabaseAdmin
      .from('stripe_events')
      .insert({ id: event.id, type: event.type, data: event.data })
    
    if (insertError?.code === '23505') {  // Unique violation
      return res.status(200).json({ received: true, duplicate: true })
    }
    
    // Process event
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
          break
        case 'customer.subscription.updated':
        case 'customer.subscription.created':
          await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
          break
        case 'customer.subscription.deleted':
          await handleSubscriptionCanceled(event.data.object as Stripe.Subscription)
          break
        case 'invoice.paid':
          await handleInvoicePaid(event.data.object as Stripe.Invoice)
          break
        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object as Stripe.Invoice)
          break
        default:
          logger.info({ type: event.type }, 'stripe_event_unhandled')
      }
      
      res.status(200).json({ received: true })
    } catch (err) {
      logger.error({ err, eventType: event.type }, 'stripe_webhook_error')
      // Delete the event so it can be retried
      await supabaseAdmin.from('stripe_events').delete().eq('id', event.id)
      res.status(500).json({ error: 'processing_failed' })
    }
  }
)
async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
  const userId = sub.metadata.user_id
  const plan = sub.metadata.plan ?? planFromPriceId(sub.items.data[0].price.id)
  
  await supabaseAdmin.from('subscriptions').upsert({
    user_id: userId,
    stripe_subscription_id: sub.id,
    stripe_customer_id: sub.customer as string,
    stripe_price_id: sub.items.data[0].price.id,
    plan,
    status: sub.status,
    current_period_start: new Date(sub.current_period_start * 1000),
    current_period_end: new Date(sub.current_period_end * 1000),
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000) : null
  }, { onConflict: 'stripe_subscription_id' })
  
  // Update user plan
  if (sub.status === 'active' || sub.status === 'trialing') {
    await supabaseAdmin
      .from('users')
      .update({ 
        plan, 
        plan_started_at: new Date(sub.current_period_start * 1000),
        plan_expires_at: new Date(sub.current_period_end * 1000)
      })
      .eq('id', userId)
    
    // Send plan change email
    await emailQueue.add('plan-changed', { userId, newPlan: plan })
  }
}
async function handleSubscriptionCanceled(sub: Stripe.Subscription) {
  const userId = sub.metadata.user_id
  await supabaseAdmin.from('users').update({ plan: 'free' }).eq('id', userId)
  await supabaseAdmin.from('subscriptions')
    .update({ status: 'canceled', canceled_at: new Date() })
    .eq('stripe_subscription_id', sub.id)
}
```






### Trial Period
New paid signups get a 14-day free trial (no card required for trial start, or card required with charge after 14 days — your choice). Configure in Stripe Checkout via `subscription_data.trial_period_days: 14`.
---
## 15. Institutional Tier ⭐
### Onboarding Flow
Institutional accounts are sales-led (no self-serve checkout — the pricing page says "Contact us").
1. School/org coordinator visits `/institutional` and fills out contact form
2. Email goes to `sales@merit.app`
3. Kai (or sales) responds, sets up a demo call
4. After sale: admin creates the chapter manually, generates the coordinator login credential, sets up Stripe subscription with custom price
### Coordinator Dashboard Data Model



```typescript
// services/admin.service.ts
export async function getChapterDashboard(chapterId: string) {
  const [
    chapterInfo,
    memberCount,
    totalHours,
    verifiedHours,
    weeklyStats,
    topContributors,
    pendingFlags
  ] = await Promise.all([
    getChapter(chapterId),
    getMemberCount(chapterId),
    getTotalHours(chapterId),
    getVerifiedHours(chapterId),
    getWeeklyStats(chapterId),
    getTopContributors(chapterId, 10),
    getPendingFraudFlags(chapterId)
  ])
  
  return {
    chapter: chapterInfo,
    metrics: {
      memberCount,
      totalHours,
      verifiedHours,
      verifiedPercent: (verifiedHours / totalHours) * 100,
      avgHoursPerMember: totalHours / memberCount
    },
    weeklyStats,
    topContributors,
    pendingFlags
  }
}
```






### Supervisor Whitelist Logic
When a coordinator adds a supervisor to the whitelist:



```typescript
async function addToWhitelist(chapterId: string, supervisor: {name, email?, phone?, orgId?}) {
  // 1. Insert into whitelist
  await supabaseAdmin.from('supervisor_whitelist').insert({
    chapter_id: chapterId,
    name: supervisor.name,
    email: supervisor.email,
    phone: supervisor.phone,
    org_id: supervisor.orgId,
    added_by: currentUser.id
  })
  
  // 2. If this supervisor has an authenticator record, promote them
  if (supervisor.email) {
    await supabaseAdmin
      .from('authenticators')
      .update({ 
        tier: 'org_email_verified',
        manually_promoted: true,
        promoted_by: currentUser.id,
        promotion_reason: `Institutional whitelist for chapter ${chapterId}`
      })
      .eq('email_lower', supervisor.email.toLowerCase())
  }
  
  // 3. If domain is new, mark it as institutional
  if (supervisor.email) {
    const domain = extractEmailDomain(supervisor.email)
    await supabaseAdmin
      .from('org_email_domains')
      .upsert({
        domain,
        domain_type: 'institutional',
        trust_score: 1.0,
        manually_verified: true
      }, { onConflict: 'domain' })
  }
  
  // 4. Retroactively upgrade past pending sessions
  await retroactivelyVerifyMatchingSessions(supervisor)
}
```






### Grant Report Generation
Coordinators export grant reports showing all hours their chapter logged, suitable for funder applications.



```typescript
// services/admin.service.ts
export async function generateGrantReport(opts: {
  chapterId: string
  from: Date
  to: Date
  groupBy: 'org' | 'member' | 'month'
}) {
  const sessions = await getChapterSessionsInRange(opts.chapterId, opts.from, opts.to)
  
  const grouped = groupSessions(sessions, opts.groupBy)
  
  // Generate PDF via @react-pdf/renderer
  const pdf = await renderGrantReportPDF({
    chapter: await getChapter(opts.chapterId),
    dateRange: { from: opts.from, to: opts.to },
    grouped,
    totals: {
      totalHours: sessions.reduce((s, x) => s + x.hours, 0),
      verifiedHours: sessions.filter(s => s.status === 'verified').reduce((s, x) => s + x.hours, 0),
      memberCount: new Set(sessions.map(s => s.user_id)).size,
      orgCount: new Set(sessions.map(s => s.org_id)).size
    }
  })
  
  // Upload to Supabase Storage with signed URL
  const path = `grant-reports/${opts.chapterId}/${Date.now()}.pdf`
  await supabaseAdmin.storage.from('exports').upload(path, pdf, { contentType: 'application/pdf' })
  const { data } = await supabaseAdmin.storage.from('exports').createSignedUrl(path, 3600)
  
  return { url: data.signedUrl, expiresIn: 3600 }
}
```






---
## 16. Notifications System ⭐
### When notifications are created
| Event | Notification |
|-------|--------------|
| Supervisor replies YES | "Your hours at {org} were verified ✓" |
| Supervisor replies NO | "{Supervisor} disputed your hours at {org}" (urgent) |
| 24h pass with no reply | "Reminder sent to {supervisor}" |
| Goal milestone (25/50/75/100%) | "You hit {percent}% of your goal" |
| Institutional invite received | "{Coordinator} invited you to join {chapter}" |
| Plan upgrade successful | "Welcome to {Plan}" |
| Payment failed | "Update your payment method" (urgent) |
| System announcement | Variable |
### Service



```typescript
// services/notifications.service.ts
export async function createNotification(opts: {
  userId: string
  type: NotificationType
  title: string
  body: string
  actionUrl?: string
  metadata?: object
}) {
  const { data } = await supabaseAdmin.from('notifications').insert(opts).select().single()
  
  // Real-time delivery via Supabase Realtime (frontend subscribes to changes)
  // Plus optional email if user has it enabled
  const user = await getUser(opts.userId)
  if (user.notifications?.[opts.type] && shouldEmailForType(opts.type)) {
    await emailQueue.add(opts.type, { userId: opts.userId, ...opts })
  }
  
  return data
}
```






### Real-time delivery (Supabase Realtime)
The frontend subscribes to changes on the `notifications` table filtered by `user_id`. No additional WebSocket infrastructure needed.



```typescript
// Frontend (not part of backend, but for reference)
supabase.channel('notifications')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
    (payload) => { /* show toast, update badge */ })
  .subscribe()
```






---
## 17. Stats & Dashboard Endpoints
Dashboard data is computed on-demand (no pre-aggregation needed at MVP scale).



```typescript
// services/stats.service.ts
export async function getDashboardStats(userId: string) {
  const user = await getUser(userId)
  const weekStart = startOfWeek(new Date())
  
  const [allSessions, weekSessions, lastSession] = await Promise.all([
    supabaseAdmin.from('sessions').select('hours, status, date')
      .eq('user_id', userId).is('deleted_at', null),
    supabaseAdmin.from('sessions').select('hours')
      .eq('user_id', userId).gte('date', weekStart.toISOString()).is('deleted_at', null),
    supabaseAdmin.from('sessions').select('*, org:organizations(*)')
      .eq('user_id', userId).is('deleted_at', null)
      .order('date', { ascending: false }).limit(1).maybeSingle()
  ])
  
  const totalHours = (allSessions.data ?? []).reduce((s, x) => s + Number(x.hours), 0)
  const verifiedHours = (allSessions.data ?? [])
    .filter(x => x.status === 'verified')
    .reduce((s, x) => s + Number(x.hours), 0)
  const pendingHours = totalHours - verifiedHours
  
  const sessionsThisWeek = weekSessions.data?.length ?? 0
  const streak = await calculateStreak(userId)
  
  return {
    totalHours,
    verifiedHours,
    pendingHours,
    goalHours: user.goal_hours,
    percentToGoal: Math.min(100, (totalHours / user.goal_hours) * 100),
    sessionsThisWeek,
    streak,
    lastSession: lastSession.data
  }
}
export async function getWeeklyStats(userId: string, weeks = 8) {
  const start = subWeeks(new Date(), weeks)
  const { data } = await supabaseAdmin
    .from('sessions')
    .select('date, hours, status')
    .eq('user_id', userId)
    .gte('date', start.toISOString())
    .is('deleted_at', null)
  
  // Group into weeks
  const buckets = new Map<string, { hours: number; sessionCount: number; verifiedCount: number }>()
  for (let i = 0; i < weeks; i++) {
    const weekStart = startOfWeek(subWeeks(new Date(), i)).toISOString()
    buckets.set(weekStart, { hours: 0, sessionCount: 0, verifiedCount: 0 })
  }
  
  for (const s of data ?? []) {
    const weekStart = startOfWeek(new Date(s.date)).toISOString()
    const bucket = buckets.get(weekStart)
    if (bucket) {
      bucket.hours += Number(s.hours)
      bucket.sessionCount++
      if (s.status === 'verified') bucket.verifiedCount++
    }
  }
  
  return Array.from(buckets.entries())
    .map(([weekStart, b]) => ({ weekStart, ...b }))
    .reverse()
}
```






---
## 18. Security
### Headers (Helmet)



```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", env.SUPABASE_URL, 'https://api.stripe.com'],
      frameSrc: ['https://js.stripe.com', 'https://hooks.stripe.com']
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}))
```






### CORS
Strict allowlist:



```typescript
const allowedOrigins = env.ALLOWED_ORIGINS.split(',')
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true)
    else cb(new Error('CORS blocked'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID']
}))
```






### Body limits



```typescript
app.use(express.json({ limit: '1mb' }))
```






### Input sanitization
- Zod validates all input strings, ints, etc.
- Activity descriptions and supervisor names are stored as-is but rendered with HTML escaping on the frontend (Next.js does this by default in JSX)
- No HTML stored in user input
### Webhook signature verification
- Twilio: HMAC-SHA1 of request URL + body with `TWILIO_WEBHOOK_AUTH_TOKEN`
- Stripe: handled by `stripe.webhooks.constructEvent`
- Resend: HMAC-SHA256 with webhook secret
### Secret rotation
- Every 90 days for Twilio Auth Token
- Every 180 days for Stripe webhook secret
- Every 180 days for cookie/magic-link secrets
- Document the rotation procedure in `RUNBOOK.md`
### Audit logging
Every sensitive operation writes to `audit_log`:
- signup, login, logout, password change
- account deletion request, deletion cancellation
- plan upgrade/downgrade
- SMS send
- chapter member add/remove
- supervisor whitelist add/remove
- admin actions
Include IP and user agent.
---
## 19. Mock Mode vs Real Mode
Mock implementations let the backend run with zero credentials.



```typescript
// config/twilio.ts
const isReal = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)
export const twilioClient = isReal 
  ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
  : createMockTwilio()
export const TWILIO_MODE = isReal ? 'real' : 'mock'
function createMockTwilio() {
  return {
    messages: {
      create: async (opts: any) => {
        logger.info({ to: opts.to, body: opts.body }, 'MOCK_SMS')
        return { sid: `mock_sms_${Date.now()}`, status: 'queued' }
      }
    }
  }
}
```






Same pattern for Resend, Stripe, and Supabase. The `/health` endpoint reports each service's mode.
---
## 20. Background Jobs
`node-cron` for scheduling. BullMQ for async work that doesn't fit a fixed schedule (sending an email after a user action, etc.).



```typescript
// src/jobs/index.ts
import cron from 'node-cron'
import { sendWeeklyDigest } from './weekly-digest.job'
import { sendVerificationReminders } from './verification-reminder.job'
import { refreshTrustScores } from './trust-score-refresh.job'
import { scanFraud } from './fraud-scan.job'
import { cleanupExpiredVerifications } from './cleanup.job'
import { processDataRetention } from './data-retention.job'
export function registerJobs() {
  // Sundays at 9 AM PT — weekly digest
  cron.schedule('0 9 * * 0', sendWeeklyDigest, { timezone: 'America/Los_Angeles' })
  
  // Daily at 10 AM PT — verification reminders
  cron.schedule('0 10 * * *', sendVerificationReminders, { timezone: 'America/Los_Angeles' })
  
  // Daily at 2 AM PT — refresh trust scores
  cron.schedule('0 2 * * *', refreshTrustScores, { timezone: 'America/Los_Angeles' })
  
  // Daily at 3 AM PT — fraud scan
  cron.schedule('0 3 * * *', scanFraud, { timezone: 'America/Los_Angeles' })
  
  // Daily at 4 AM PT — cleanup expired verifications
  cron.schedule('0 4 * * *', cleanupExpiredVerifications, { timezone: 'America/Los_Angeles' })
  
  // Daily at 5 AM PT — data retention (delete users past their 30-day deletion window)
  cron.schedule('0 5 * * *', processDataRetention, { timezone: 'America/Los_Angeles' })
  
  // Hourly — clean up old ip_rate_limits rows
  cron.schedule('0 * * * *', cleanupIpRateLimits)
}
```






### BullMQ Queues



```typescript
// queues/email.queue.ts
import { Queue, Worker } from 'bullmq'
import { redis } from '../config/redis'
export const emailQueue = new Queue('email', { connection: redis })
new Worker('email', async (job) => {
  const { template, userId, data } = job.data
  await sendEmail(template, userId, data)
}, { connection: redis, concurrency: 5 })
```






Used for: sending emails async after user actions, generating PDFs async, processing webhooks.
---
## 21. Logging & Error Monitoring
### Pino logger



```typescript
// lib/logger.ts
import pino from 'pino'
export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: env.NODE_ENV === 'development' 
    ? { target: 'pino-pretty', options: { colorize: true } } 
    : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      '*.password',
      '*.token',
      '*.secret',
      '*.stripe_secret_key',
      '*.supabase_service_role_key',
      '*.twilio_auth_token'
    ],
    censor: '[REDACTED]'
  },
  base: { service: 'merit-backend', env: env.NODE_ENV }
})
```






Every log line includes `requestId` when available (set by request-id middleware).
### Sentry integration



```typescript
// config/sentry.ts
import * as Sentry from '@sentry/node'
import { ProfilingIntegration } from '@sentry/profiling-node'
export function initSentry() {
  if (!env.SENTRY_DSN) return
  
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app }),
      new ProfilingIntegration()
    ],
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    profilesSampleRate: 0.1,
    beforeSend(event) {
      // Don't send 4xx errors (user errors) to Sentry
      if (event.tags?.statusCode && Number(event.tags.statusCode) < 500) return null
      return event
    }
  })
}
// app.ts
app.use(Sentry.Handlers.requestHandler())
app.use(Sentry.Handlers.tracingHandler())
// ... routes
app.use(Sentry.Handlers.errorHandler())
app.use(errorHandler)  // Custom handler runs after Sentry
```






---
## 22. Testing
Vitest + Supertest. Aim for **80% coverage on services**, 70% on routes, 100% on trust/fraud/billing logic (these are correctness-critical).
### Critical test paths



```typescript
// tests/auth.test.ts
describe('POST /auth/signup', () => {
  it('blocks signup under age 13', async () => {
    const res = await request(app).post('/auth/signup').send({
      email: 'kid@example.com',
      password: 'StrongPass123!',
      name: 'Kid',
      dateOfBirth: '2015-01-01'  // 11 years old in 2026
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('age_restricted')
  })
  
  it('requires parent email for ages 13-17', async () => {
    const res = await request(app).post('/auth/signup').send({
      email: 'teen@example.com',
      password: 'StrongPass123!',
      name: 'Teen',
      dateOfBirth: '2010-01-01'  // 16 years old
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('parental_email_required')
  })
  
  it('rejects weak passwords', async () => {
    const res = await request(app).post('/auth/signup').send({
      email: 'adult@example.com',
      password: 'password',  // Common, weak
      name: 'Adult',
      dateOfBirth: '2000-01-01'
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('weak_password')
  })
})
// tests/trust.test.ts
describe('Trust System', () => {
  it('classifies gmail as personal_email tier', async () => {
    const auth = await resolveOrCreateAuthenticator({
      name: 'John',
      email: 'john@gmail.com'
    })
    expect(auth.tier).toBe('personal_email')
  })
  
  it('classifies new custom domain as org_email_unverified', async () => {
    const auth = await resolveOrCreateAuthenticator({
      name: 'Jane',
      email: 'jane@newcompany.com'
    })
    expect(auth.tier).toBe('org_email_unverified')
  })
  
  it('promotes domain to verified after 3+ authenticators', async () => {
    // Create 3 authenticators on same domain
    for (let i = 0; i < 3; i++) {
      await resolveOrCreateAuthenticator({
        name: `User ${i}`,
        email: `user${i}@trustedco.com`
      })
    }
    await recalculateDomainTrust('trustedco.com')
    
    const auth = await resolveOrCreateAuthenticator({
      name: 'New User',
      email: 'newuser@trustedco.com'
    })
    expect(auth.tier).toBe('org_email_verified')
  })
})
// tests/fraud.test.ts
describe('Fraud detection', () => {
  it('flags 20-hour sessions', async () => {
    const { score, flags } = await calculateFraudScore({
      hours: 20,
      // ...
    })
    expect(score).toBeGreaterThan(0.5)
    expect(flags).toContain('impossible_hours')
  })
})
// tests/billing.test.ts
describe('Stripe webhook idempotency', () => {
  it('processes each event only once', async () => {
    const event = mockStripeEvent('checkout.session.completed')
    const res1 = await sendWebhook(event)
    const res2 = await sendWebhook(event)  // Same event ID
    
    expect(res1.body.duplicate).toBeUndefined()
    expect(res2.body.duplicate).toBe(true)
  })
})
```






---
## 23. CI/CD Pipeline
### `.github/workflows/ci.yml`



```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7-alpine
        ports: [6379:6379]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:coverage
        env:
          REDIS_URL: redis://localhost:6379
      - uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
```






### `.github/workflows/deploy.yml`



```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Railway
        run: |
          curl -X POST https://backboard.railway.app/graphql/v2 \
            -H "Authorization: Bearer ${{ secrets.RAILWAY_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{"query":"mutation { serviceInstanceDeploy(input: {serviceId: \"${{ secrets.RAILWAY_SERVICE_ID }}\"}) { id } }"}'
      
      - name: Run migrations
        run: |
          npm ci
          npx supabase db push --linked
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      
      - name: Notify Sentry of release
        uses: getsentry/action-release@v1
        with:
          environment: production
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: merit
          SENTRY_PROJECT: backend
```






---
## 24. Deployment (Railway)
### `railway.json`



```json
{
  "build": { 
    "builder": "NIXPACKS",
    "buildCommand": "npm ci && npm run build"
  },
  "deploy": {
    "startCommand": "npm run start",
    "healthcheckPath": "/health/ready",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```






### `package.json` scripts



```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "db:types": "supabase gen types typescript --project-id $SUPABASE_PROJECT_ID > src/types/database.types.ts",
    "db:migrate": "supabase db push",
    "db:reset": "supabase db reset",
    "seed": "ts-node scripts/seed.ts"
  }
}
```






### Railway setup steps
1. Connect Railway to `merit-app/merit-backend` GitHub repo
2. Add a Redis plugin (for BullMQ)
3. Add all env variables in Railway dashboard
4. Set start command (`npm run start`)
5. Set healthcheck path to `/health/ready`
6. Railway auto-deploys on push to `main`
### Rollback
Railway supports one-click rollback to a previous deployment. Procedure documented in `RUNBOOK.md`.
---
## 25. Error Handling



```typescript
// lib/errors.ts
export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 400,
    public details?: any
  ) { super(message) }
}
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('not_found', `${resource} not found`, 404)
  }
}
export class UnauthorizedError extends AppError {
  constructor(msg = 'Authentication required') { super('unauthorized', msg, 401) }
}
export class ForbiddenError extends AppError {
  constructor(msg = 'Forbidden') { super('forbidden', msg, 403) }
}
export class ValidationError extends AppError {
  constructor(details: any) {
    super('validation_failed', 'Input validation failed', 400, details)
  }
}
export class RateLimitError extends AppError {
  constructor(details: any) {
    super('rate_limit_exceeded', 'Too many requests', 429, details)
  }
}
// middleware/error-handler.middleware.ts
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  const requestId = req.id
  
  if (err instanceof AppError) {
    logger.warn({ err: err.message, code: err.code, requestId }, 'app_error')
    return res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      details: err.details,
      requestId
    })
  }
  
  // Zod errors
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'validation_failed',
      message: 'Input validation failed',
      details: (err as any).errors,
      requestId
    })
  }
  
  // Anything else is 500
  logger.error({ err, path: req.path, requestId }, 'unhandled_error')
  Sentry.captureException(err)
  
  res.status(500).json({
    error: 'internal_server_error',
    message: 'Something went wrong on our end. We have been notified.',
    requestId
  })
}
```






---
## 26. Legal & Compliance (COPPA, PIPEDA, CASL, GDPR) ⭐
### Age verification (COPPA-adjacent)
- Block under 13 at signup
- Ages 13-17: collect parent email, send consent email, store `parental_consent_received` flag
- Don't enable SMS sending until consent received (for minors)
### PIPEDA (BC privacy law)
- Explicit consent at signup ("By signing up, you agree to our [Privacy Policy] and [Terms]")
- Data minimization: only collect what's needed
- Data residency: use Supabase `ca-central-1` region (Montreal) for Canadian users
- Right to access: `GET /users/me/export`
- Right to correction: `PATCH /users/me`
- Right to deletion: `DELETE /users/me` (30-day grace period)
### CASL (Canadian Anti-Spam)
- Marketing emails require **explicit** opt-in (separate checkbox at signup)
- `marketing_consent` and `marketing_consent_at` on users table
- Transactional emails (verification, password reset, billing) don't require opt-in
- Every marketing email has unsubscribe link
### GDPR (for any EU users)
- Same rights as PIPEDA, plus:
- Cookie consent banner on frontend
- Data Processing Agreement available on request
- Right to be forgotten — hard delete after 30 days
### FERPA consideration
- If a US school becomes an institutional client, their use may trigger FERPA
- Don't share student data with anyone outside the chapter
- Coordinator views are limited to their chapter only (enforced by RLS + role middleware)
### Data Retention Policy
| Data | Retention |
|------|-----------|
| Active user data | Indefinite while account active |
| Deleted user data | 30 days, then hard-deleted |
| Audit logs | 7 years (compliance) |
| Stripe invoices | 7 years (tax compliance) |
| Email/SMS verification logs | 2 years |
| Rate limit rows | 30 days |
| IP rate limit rows | 24 hours |
### Data Retention Job



```typescript
// jobs/data-retention.job.ts
export async function processDataRetention() {
  // 1. Hard-delete users past their 30-day deletion window
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  
  const { data: usersToDelete } = await supabaseAdmin
    .from('users')
    .select('id, email')
    .lt('deletion_scheduled_for', cutoff.toISOString())
  
  for (const user of usersToDelete ?? []) {
    await supabaseAdmin.auth.admin.deleteUser(user.id)
    // CASCADE in DB will remove all related rows
    logger.info({ userId: user.id }, 'user_hard_deleted')
  }
  
  // 2. Clean up old audit logs (>7 years)
  const sevenYearsAgo = new Date()
  sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7)
  await supabaseAdmin.from('audit_log').delete().lt('created_at', sevenYearsAgo.toISOString())
  
  // 3. Clean up old verifications (>2 years)
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  await supabaseAdmin.from('verifications').delete().lt('sent_at', twoYearsAgo.toISOString())
}
```






---
## 27. PDF Export Security
### Signed URLs
PDFs are generated and stored in Supabase Storage. Returned URLs are **signed** with 1-hour expiry.



```typescript
// services/storage.service.ts
export async function uploadPDF(path: string, pdfBuffer: Buffer): Promise<string> {
  const { error } = await supabaseAdmin.storage
    .from('exports')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      cacheControl: '3600'
    })
  if (error) throw error
  
  const { data } = await supabaseAdmin.storage
    .from('exports')
    .createSignedUrl(path, 3600)  // 1 hour TTL
  
  return data!.signedUrl
}
```






### Plan-gated downloads
PDF generation enforces plan limits server-side. Even if frontend tries to request a Premium template on a Free account, the backend rejects.



```typescript
router.post('/exports/pdf', 
  requireAuth,
  rateLimit('pdf_export', { free: 3, pro: 10, premium: 999, institutional: 999 }),
  validate(pdfExportSchema),
  async (req, res) => {
    const { template } = req.body
    const allowedTemplates = PLAN_FEATURES[req.user.plan].pdfTemplates
    
    if (!allowedTemplates.includes(template)) {
      throw new ForbiddenError(`Template "${template}" is not available on the ${req.user.plan} plan.`)
    }
    
    // Generate, upload, return signed URL
    const pdf = await generatePDF(req.user.id, req.body)
    const path = `users/${req.user.id}/${Date.now()}.pdf`
    const url = await uploadPDF(path, pdf)
    
    res.json({ data: { url, expiresIn: 3600 } })
  }
)
```






### Watermarking (optional, free tier)
Free-tier PDFs include a "Generated with Merit — merit.app" watermark. Pro+ get clean exports.
---
## 28. What NOT to Do
❌ Don't put business logic in route handlers — it belongs in services
❌ Don't trust JWT claims without verifying the signature
❌ Don't query the database directly from route handlers — always go through services
❌ Don't return stack traces or raw error messages to clients
❌ Don't log secrets, even in dev
❌ Don't use `any` types in TypeScript — be strict
❌ Don't catch errors silently — always log them
❌ Don't use synchronous I/O (`fs.readFileSync`, etc.)
❌ Don't store passwords — Supabase Auth handles that
❌ Don't accept untrusted phone numbers without normalizing to E.164
❌ Don't send SMS without checking rate limits AND opt-outs first
❌ Don't deploy without env validation — fail fast on missing required vars
❌ Don't process Stripe webhooks without idempotency checks
❌ Don't expose unsigned PDF URLs
❌ Don't permanently delete data without the 30-day grace period
❌ Don't mark a domain as trusted from a single verification
❌ Don't allow admin-tier actions without `requireRole('coordinator', 'admin')`
❌ Don't email marketing content without explicit `marketing_consent = true`
✅ Validate every input with Zod
✅ Use service-layer functions for all business logic
✅ Log structured JSON to stdout
✅ Use TypeScript strict mode
✅ Cache ProPublica results in the local DB
✅ Verify Twilio webhook signatures
✅ Verify Stripe webhook signatures (and check idempotency)
✅ Rate limit every expensive operation (DB-backed, not in-memory)
✅ Write tests for trust/fraud/billing logic (100% coverage)
✅ Use UUIDs for all primary keys
✅ Use ISO 8601 for all dates
✅ Soft-delete user-facing data, hard-delete only after retention period
✅ Send Sentry errors only for 5xx (not 4xx user errors)
---
## 29. Definition of Done
Before considering this backend "shippable":
1. ✅ All routes return correct responses (tested with frontend in dev)
2. ✅ All routes validate input with Zod
3. ✅ All routes log to Pino with request IDs
4. ✅ Rate limiting works per-plan (test by exceeding free limit)
5. ✅ Email confirmation flow works end-to-end with Resend
6. ✅ SMS verification works end-to-end with Twilio (real or mock)
7. ✅ Magic link email verification works (supervisor flow)
8. ✅ ProPublica search returns real orgs and caches them
9. ✅ Auth middleware blocks unauthenticated requests
10. ✅ Role middleware blocks non-coordinators from admin routes
11. ✅ Plan-gate middleware blocks features the user can't access
12. ✅ RLS policies are active in Supabase
13. ✅ `/health` returns 200 and reports mode correctly per service
14. ✅ Mock mode works with zero env vars (only NODE_ENV and PORT required)
15. ✅ Trust scoring promotes domains after 3+ unique authenticators
16. ✅ Fraud detection flags impossible-hours sessions
17. ✅ Stripe webhook handles checkout, subscription updates, and cancellations
18. ✅ Stripe webhook is idempotent (replay test passes)
19. ✅ Failed payments trigger user notification
20. ✅ PDF exports are plan-gated and use signed URLs
21. ✅ Notifications are created on key events and delivered via Supabase Realtime
22. ✅ Background jobs run on schedule (verification reminders, weekly digest, trust refresh)
23. ✅ Account deletion has 30-day grace period
24. ✅ Data export endpoint returns full user data
25. ✅ Parental consent flow works for minors
26. ✅ Marketing emails require explicit opt-in (CASL)
27. ✅ Sentry captures 5xx errors but not 4xx
28. ✅ All tests pass with >80% coverage
29. ✅ Deployed to Railway with all env vars set
30. ✅ Frontend can call backend in production (CORS configured)
---
## 30. Setup Instructions



```bash
cd C:\Users\Kai\Desktop\Merit\merit-backend
npm init -y
# Core deps
npm install express cors helmet morgan pino pino-pretty zod dotenv
npm install @supabase/supabase-js twilio resend posthog-node
npm install stripe @sentry/node @sentry/profiling-node
npm install zxcvbn-ts libphonenumber-js
npm install node-cron undici bullmq ioredis
npm install @react-email/components react-email
# Dev deps
npm install -D typescript ts-node-dev @types/node @types/express @types/cors @types/morgan @types/node-cron
npm install -D vitest @vitest/coverage-v8 supertest @types/supertest
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
npm install -D prettier
npx tsc --init
```






Configure `tsconfig.json`: strict mode, ES2022 target, NodeNext module resolution.
Create folder structure per section 4.
Initialize git, add `.env` to `.gitignore`, commit the scaffold.
---
## 31. Build Order
Build in this exact sequence. Each step builds on the previous.
1. **Scaffold** — npm init, install deps, create folder structure, tsconfig
2. **Config layer** — `env.ts` (Zod-validated), Supabase/Twilio/Resend/Stripe clients with mock mode, Sentry init, Redis client
3. **Logger and error classes** — `lib/logger.ts`, `lib/errors.ts`
4. **Middleware** — request-id, auth, role, validate, rate-limit, plan-gate, error-handler, not-found
5. **Express app** — `app.ts` with all middleware wired up
6. **Health route** — `GET /health`, `GET /health/ready`
7. **Database migrations 001-008** — create all tables, indexes, RLS, triggers in Supabase
8. **Trust system services** — `trust.service.ts`, `fraud.service.ts`, `lib/email-domain.ts`
9. **Auth routes + service** — signup (with age/parental/password checks), login (with lockout), refresh, password reset, email confirm, parental consent
10. **Users routes + service** — me, update, delete (soft), export
11. **Organizations routes + service** — search (with ProPublica + cache), get, list mine
12. **Sessions routes + service** — full CRUD, integrates trust + fraud services
13. **Verifications routes + service** — send SMS, send email magic link, handle responses
14. **Twilio inbound webhook** — handle YES/NO/STOP
15. **Magic link routes** — supervisor email confirmation
16. **Resend email templates** — all 9 templates as React Email components
17. **Background jobs** — weekly digest, verification reminders, trust score refresh, fraud scan, cleanup, data retention
18. **Stats routes + service** — dashboard, weekly, by-org, by-month
19. **Notifications routes + service** — CRUD + Supabase Realtime triggers
20. **Billing routes + service** — Stripe customer, checkout, portal, subscription sync
21. **Stripe webhook** — with idempotency
22. **Admin routes + service** — chapter, members, supervisor whitelist, grant reports
23. **Exports route** — server-side PDF generation, signed URLs, plan gating
24. **Tests** — Vitest suite for all critical paths (target 80% coverage)
25. **CI/CD** — GitHub Actions for test + deploy
26. **Railway deployment** — connect repo, set env vars, add Redis plugin, deploy
27. **Frontend integration** — update frontend API base URL to point at Railway
**Commit after each step.** Don't bundle multiple steps into one commit.
---
## 32. Integration Checklist (When API Keys Arrive)
When the cofounder sends keys, you go from mock → real instantly. No code changes.
Paste keys into `.env`:



```bash
SUPABASE_URL=https://abcxyz.supabase.co
SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...
SUPABASE_JWT_SECRET=xxx...
SUPABASE_PROJECT_ID=abcxyz
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_MESSAGING_SERVICE_SID=MGxxx
TWILIO_WEBHOOK_AUTH_TOKEN=xxx
RESEND_API_KEY=re_xxx
STRIPE_SECRET_KEY=sk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_PRO_MONTHLY=price_xxx
STRIPE_PRICE_PRO_YEARLY=price_xxx
STRIPE_PRICE_PREMIUM_MONTHLY=price_xxx
STRIPE_PRICE_PREMIUM_YEARLY=price_xxx
STRIPE_PRICE_INSTITUTIONAL=price_xxx
SENTRY_DSN=https://xxx@sentry.io/xxx
POSTHOG_API_KEY=phc_xxx
REDIS_URL=redis://default:xxx@xxx.railway.internal:6379
```



Then:
1. Run database migrations: `npm run db:migrate`
2. Generate TypeScript types from Supabase: `npm run db:types`
3. Restart server: `npm run dev`
4. Verify `/health` shows `mode: 'real'` for each service
5. Test signup end-to-end — real email arrives via Resend
6. Test session creation with SMS — real text arrives via Twilio
7. Reply YES from your phone — session updates to verified
8. Test Stripe Checkout — create test purchase, webhook fires, user upgrades to Pro
9. Test plan downgrade — cancel test subscription, user drops to Free
10. Push to GitHub → Railway auto-deploys → real-mode in production
That's it. Mock → real with zero code changes.
---
## 33. One Last Thing
This backend is the trust layer of the entire product. A student's volunteer hours are going to be used to apply to colleges and qualify for graduation. **If the verification can be faked, the product is worthless. If the data leaks, the product is worse than worthless — it's actively harmful.**
The two-tier authenticator system is your moat. Every competitor can send an SMS. None of them have the network-effect-driven trust score. The longer Merit runs, the harder it becomes to fake — that's the compounding advantage.
Build defensively. Validate everything. Log everything. Trust nothing from the client. When in doubt, write a test.
The best backends are invisible. Users never think about them. They just work.
Now build it.