-- Migration: 015_org_platform.sql
-- Applied: directly in Supabase SQL Editor
-- Description: Standalone org platform tables — org_events, event_signups,
--              org_messages, org_invites — with indexes and RLS policies.

-- ── Org Events (shifts/volunteer opportunities) ──────────────
CREATE TABLE IF NOT EXISTS public.org_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES public.users(id),
  title           text NOT NULL,
  description     text,
  location        text,
  location_url    text,
  program         text,
  start_time      timestamptz NOT NULL,
  end_time        timestamptz NOT NULL,
  max_volunteers  integer,
  min_volunteers  integer DEFAULT 1,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','cancelled','completed')),
  hours_value     numeric(4,1),
  auto_log_hours  boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Event Signups ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_signups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES public.org_events(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'signed_up'
                  CHECK (status IN (
                    'signed_up','waitlisted','cancelled','checked_in','no_show'
                  )),
  signed_up_at  timestamptz NOT NULL DEFAULT now(),
  checked_in_at timestamptz,
  UNIQUE(event_id, user_id)
);

-- ── Org Messages (bulk SMS history) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.org_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sent_by          uuid NOT NULL REFERENCES public.users(id),
  message          text NOT NULL,
  recipient_count  integer NOT NULL DEFAULT 0,
  recipient_filter jsonb,
  status           text NOT NULL DEFAULT 'sent'
                     CHECK (status IN ('sent','failed','partial')),
  sent_at          timestamptz NOT NULL DEFAULT now()
);

-- ── Org Invites ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invited_by  uuid NOT NULL REFERENCES public.users(id),
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'coordinator'
                CHECK (role IN ('coordinator','admin','owner')),
  token       text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  accepted_at timestamptz,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_org_events_org      ON public.org_events(org_id);
CREATE INDEX IF NOT EXISTS idx_org_events_start    ON public.org_events(start_time);
CREATE INDEX IF NOT EXISTS idx_org_events_status   ON public.org_events(status);
CREATE INDEX IF NOT EXISTS idx_event_signups_event ON public.event_signups(event_id);
CREATE INDEX IF NOT EXISTS idx_event_signups_user  ON public.event_signups(user_id);
CREATE INDEX IF NOT EXISTS idx_org_messages_org    ON public.org_messages(org_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_token   ON public.org_invites(token);
CREATE INDEX IF NOT EXISTS idx_org_invites_email   ON public.org_invites(email);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.org_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invites   ENABLE ROW LEVEL SECURITY;

-- Org events: org admins can manage; anyone can read published
CREATE POLICY "Public can read published events"
  ON public.org_events FOR SELECT
  USING (status = 'published');

CREATE POLICY "Org admins can manage events"
  ON public.org_events FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_admins
      WHERE org_id = org_events.org_id AND user_id = auth.uid()
    )
  );

-- Event signups: authenticated users can read all; manage own rows
CREATE POLICY "Users can read event signups"
  ON public.event_signups FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can manage own signups"
  ON public.event_signups FOR ALL TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Org messages: org admins only
CREATE POLICY "Org admins can read messages"
  ON public.org_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_admins
      WHERE org_id = org_messages.org_id AND user_id = auth.uid()
    )
  );

-- Org invites: org admins can manage; anyone can read by token
CREATE POLICY "Org admins can manage invites"
  ON public.org_invites FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_admins
      WHERE org_id = org_invites.org_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Anyone can read invite by token"
  ON public.org_invites FOR SELECT USING (true);
