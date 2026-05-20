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
    exists (
      select 1 from public.sessions
      where sessions.id = verifications.session_id
        and sessions.user_id = auth.uid()
    )
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
    or exists (
      select 1 from public.chapter_coordinators
      where chapter_id = chapters.id and user_id = auth.uid()
    )
    or exists (
      select 1 from public.users
      where users.id = auth.uid() and users.chapter_id = chapters.id
    )
  );

-- Supervisor whitelist: coordinators only
create policy "Coordinators can manage whitelist" on public.supervisor_whitelist
  for all using (
    exists (
      select 1 from public.chapters
      where chapters.id = supervisor_whitelist.chapter_id
        and chapters.primary_coordinator_id = auth.uid()
    )
    or exists (
      select 1 from public.chapter_coordinators
      where chapter_id = supervisor_whitelist.chapter_id
        and user_id = auth.uid()
    )
  );
