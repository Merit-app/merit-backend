-- 030_consent_audit.sql
-- Phase 4 trust layer: student consent timestamp + a chapter audit log for
-- accountability over actions taken on students' data.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS chapter_consent_at timestamptz;

CREATE TABLE IF NOT EXISTS public.chapter_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id     uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  actor_user_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_name     text,
  action         text NOT NULL,
  target_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  target_name    text,
  detail         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chapter_audit_chapter ON public.chapter_audit_log (chapter_id, created_at DESC);
ALTER TABLE public.chapter_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chapter_audit_service ON public.chapter_audit_log;
CREATE POLICY chapter_audit_service ON public.chapter_audit_log
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
