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

-- Add FK from users.chapter_id → chapters.id (now that chapters exists)
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

-- updated_at trigger for chapters
create trigger trg_chapters_updated_at
  before update on public.chapters
  for each row execute function public.set_updated_at();
