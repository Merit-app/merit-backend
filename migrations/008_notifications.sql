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
