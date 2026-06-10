-- 029_partners_opportunities.sql
-- Phase 3b: chapter ↔ org partnerships (with a comped plan) and chapter-posted
-- volunteering opportunities students can sign up for.

-- ── Partner organizations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chapter_partners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id    uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  org_name      text NOT NULL,
  contact_email text NOT NULL,
  org_id        uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  comp_plan     text NOT NULL DEFAULT 'pro',
  invite_token  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_chapter_partners_chapter ON public.chapter_partners (chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_partners_token ON public.chapter_partners (invite_token) WHERE invite_token IS NOT NULL;
ALTER TABLE public.chapter_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chapter_partners_service ON public.chapter_partners;
CREATE POLICY chapter_partners_service ON public.chapter_partners
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── Opportunities ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chapter_opportunities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id  uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  org_name    text,
  slots       integer,
  starts_at   timestamptz,
  location    text,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chapter_opps_chapter ON public.chapter_opportunities (chapter_id);
ALTER TABLE public.chapter_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chapter_opps_service ON public.chapter_opportunities;
CREATE POLICY chapter_opps_service ON public.chapter_opportunities
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.opportunity_signups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.chapter_opportunities(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'signed_up' CHECK (status IN ('signed_up', 'waitlisted', 'cancelled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_opp_signups_opp ON public.opportunity_signups (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opp_signups_user ON public.opportunity_signups (user_id);
ALTER TABLE public.opportunity_signups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS opp_signups_service ON public.opportunity_signups;
CREATE POLICY opp_signups_service ON public.opportunity_signups
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
