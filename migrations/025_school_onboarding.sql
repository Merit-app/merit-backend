-- 025_school_onboarding.sql
-- School onboarding funnel: lead capture + admin-provisioned chapters that the
-- coordinator claims via an email-locked token.

-- ── School leads (landing-page "request early access" form) ──────────────────
CREATE TABLE IF NOT EXISTS public.school_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name       text NOT NULL,
  coordinator_name  text NOT NULL,
  email             text NOT NULL,
  role              text,
  student_count     integer,
  note              text,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  chapter_id        uuid REFERENCES public.chapters(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_school_leads_status ON public.school_leads (status, created_at DESC);

-- RLS: only the service role (backend) touches this table. No public/anon access.
ALTER TABLE public.school_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_leads_service ON public.school_leads;
CREATE POLICY school_leads_service ON public.school_leads
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── Chapter claim columns ────────────────────────────────────────────────────
-- A chapter can be provisioned by the platform admin before its coordinator has
-- claimed it. The claim is locked to the email the admin approved.
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS claim_token text;
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS claim_token_expires timestamptz;
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS pending_coordinator_email text;

-- Allow an unclaimed chapter to exist with no coordinator yet.
ALTER TABLE public.chapters ALTER COLUMN primary_coordinator_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chapters_claim_token ON public.chapters (claim_token) WHERE claim_token IS NOT NULL;
