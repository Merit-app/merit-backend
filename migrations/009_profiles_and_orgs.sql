-- ─── PROFILES + BADGES + ORG ACCOUNTS + ONBOARDING ───────────────
-- Adds public profile system, badge system, org claim/admin system,
-- and onboarding flags. Phase 1 of merit_feature_spec_v1.md.

-- ─── USERNAMES + PROFILE FIELDS ───────────────────────────────────
alter table public.users
  add column if not exists username text unique,
  add column if not exists username_changed_at timestamptz,
  add column if not exists profile_public boolean default true,
  add column if not exists bio text check (length(bio) <= 200),
  add column if not exists top_badge_ids text[] default '{}';

create index if not exists idx_users_username on public.users(username);
create index if not exists idx_users_profile_public on public.users(profile_public)
  where profile_public = true;

-- ─── ONBOARDING FLAGS ─────────────────────────────────────────────
alter table public.users
  add column if not exists onboarding_completed boolean default false,
  add column if not exists onboarding_skipped_at timestamptz;

-- ─── BADGES ───────────────────────────────────────────────────────
create table if not exists public.badges (
  id text primary key,
  name text not null,
  description text not null,
  tier text not null check (tier in ('bronze', 'silver', 'gold', 'platinum')),
  icon_name text not null,
  condition_type text not null,
  condition_value jsonb not null,
  display_order int not null default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.user_badges (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  badge_id text references public.badges(id) on delete cascade,
  earned_at timestamptz default now(),
  unique (user_id, badge_id)
);

create index if not exists idx_user_badges_user on public.user_badges(user_id);
create index if not exists idx_user_badges_badge on public.user_badges(badge_id);

-- Daily refreshed badge rarity stats
create table if not exists public.badge_stats (
  badge_id text primary key references public.badges(id) on delete cascade,
  total_earned int not null default 0,
  percent_of_users numeric(5,2) not null default 0,
  last_computed_at timestamptz default now()
);

-- ─── ORG ACCOUNTS ─────────────────────────────────────────────────
alter table public.organizations
  add column if not exists slug text unique,
  add column if not exists claimed boolean default false,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by_user_id uuid references public.users(id),
  add column if not exists logo_url text,
  add column if not exists cover_url text,
  add column if not exists description text check (length(description) <= 1000),
  add column if not exists website_url text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists is_recruiting boolean default false,
  add column if not exists org_plan text default 'free' check (org_plan in ('free', 'institutional'));

create index if not exists idx_organizations_slug on public.organizations(slug);
create index if not exists idx_organizations_claimed on public.organizations(claimed);

-- Org admins (users with admin access to an org)
create table if not exists public.org_admins (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  role text not null check (role in ('employee', 'coordinator', 'owner', 'board_member', 'other')),
  role_label text,
  created_at timestamptz default now(),
  unique (org_id, user_id)
);

create index if not exists idx_org_admins_org on public.org_admins(org_id);
create index if not exists idx_org_admins_user on public.org_admins(user_id);

-- Org claim attempts (security audit trail)
-- ip_address is text to match public.ip_rate_limits.ip_address (001_initial_schema.sql)
create table if not exists public.org_claims (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  email text not null,
  email_domain text not null,
  role text not null,
  role_label text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'approved', 'rejected', 'expired')),
  verification_token text unique,
  verification_token_expires_at timestamptz,
  domain_matched boolean default false,
  rejected_reason text,
  ip_address text,
  user_agent text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_org_claims_org on public.org_claims(org_id);
create index if not exists idx_org_claims_user on public.org_claims(user_id);
create index if not exists idx_org_claims_status on public.org_claims(status);
create index if not exists idx_org_claims_token on public.org_claims(verification_token);

-- Manual session verifications by org admins
alter table public.sessions
  add column if not exists org_verified_by_user_id uuid references public.users(id),
  add column if not exists org_verified_at timestamptz;

-- ─── RLS POLICIES ─────────────────────────────────────────────────
alter table public.user_badges enable row level security;
alter table public.org_admins enable row level security;
alter table public.org_claims enable row level security;

drop policy if exists "user_badges_select_own" on public.user_badges;
create policy "user_badges_select_own" on public.user_badges
  for select using (user_id = auth.uid());

drop policy if exists "user_badges_select_public_profile" on public.user_badges;
create policy "user_badges_select_public_profile" on public.user_badges
  for select using (
    exists (
      select 1 from public.users
      where users.id = user_badges.user_id
        and users.profile_public = true
    )
  );

drop policy if exists "org_admins_select_own" on public.org_admins;
create policy "org_admins_select_own" on public.org_admins
  for select using (user_id = auth.uid());

drop policy if exists "org_claims_select_own" on public.org_claims;
create policy "org_claims_select_own" on public.org_claims
  for select using (user_id = auth.uid());

-- ─── SEED BADGES ──────────────────────────────────────────────────
insert into public.badges (id, name, description, tier, icon_name, condition_type, condition_value, display_order) values
  -- BRONZE
  ('first_shift', 'First Shift', 'Logged your first volunteer session', 'bronze', 'Sparkles', 'session_count', '{"min": 1}', 1),
  ('word_of_honor', 'Word of Honor', 'Got your first session verified by a supervisor', 'bronze', 'BadgeCheck', 'verified_count', '{"min": 1}', 2),
  ('show_up', 'Show Up', 'Logged sessions 3 weeks in a row', 'bronze', 'CalendarCheck', 'weekly_streak', '{"min": 3}', 3),
  ('community_hopper', 'Community Hopper', 'Volunteered at 3 different organizations', 'bronze', 'MapPin', 'unique_orgs', '{"min": 3}', 4),
  ('ten_strong', 'Ten Strong', 'Reached 10 verified hours', 'bronze', 'Award', 'verified_hours', '{"min": 10}', 5),
  -- SILVER
  ('regular', 'Regular', 'Logged a session every month for 3 months', 'silver', 'CalendarHeart', 'monthly_streak', '{"min": 3}', 10),
  ('five_doors', 'Five Doors', 'Volunteered at 5 different organizations', 'silver', 'Compass', 'unique_orgs', '{"min": 5}', 11),
  ('quarter_mark', 'Quarter Mark', 'Reached 25 verified hours', 'silver', 'Medal', 'verified_hours', '{"min": 25}', 12),
  ('nhs_bound', 'NHS Bound', 'Reached 75 hours logged', 'silver', 'GraduationCap', 'total_hours', '{"min": 75}', 13),
  ('locked_in', 'Locked In', 'Maintained a 4 week streak', 'silver', 'Flame', 'weekly_streak', '{"min": 4}', 14),
  -- GOLD
  ('fifty', 'Fifty', 'Reached 50 verified hours', 'gold', 'Trophy', 'verified_hours', '{"min": 50}', 20),
  ('triple_digits', 'Triple Digits', 'Reached 100 verified hours', 'gold', 'Crown', 'verified_hours', '{"min": 100}', 21),
  ('half_year', 'Half Year', '6 month volunteer streak', 'gold', 'Sun', 'monthly_streak', '{"min": 6}', 22),
  ('ib_done', 'IB Done', 'Reached 150 verified hours — IB CAS complete', 'gold', 'BookOpenCheck', 'verified_hours', '{"min": 150}', 23),
  -- PLATINUM
  ('two_hundred', 'Two Hundred', 'Reached 200 verified hours', 'platinum', 'Gem', 'verified_hours', '{"min": 200}', 30),
  ('unbroken', 'Unbroken', '365 day active volunteer streak', 'platinum', 'Infinity', 'day_streak', '{"min": 365}', 31),
  ('home_base', 'Home Base', '50+ verified hours at a single organization', 'platinum', 'Home', 'single_org_hours', '{"min": 50}', 32),
  ('spotless', 'Spotless', '20+ sessions logged with 100% verification rate', 'platinum', 'ShieldCheck', 'verification_rate', '{"min_sessions": 20, "min_rate": 1.0}', 33)
on conflict (id) do nothing;

-- Initialize badge stats (one row per badge, zeroed)
insert into public.badge_stats (badge_id, total_earned, percent_of_users)
select id, 0, 0 from public.badges
on conflict (badge_id) do nothing;
