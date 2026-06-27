-- 041_sessions_shared_with_chapter.sql
-- Per-session control over what a student shares with their school/chapter.
-- Default TRUE so every existing and future session stays visible (preserves today's
-- behavior + the "it just shows up" promise); students can now EXCLUDE specific orgs or
-- sessions from their school's view. Only shared, verified, non-self-reported hours count
-- toward a chapter requirement and appear in the coordinator's dashboard/reports.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS shared_with_chapter boolean NOT NULL DEFAULT true;

-- Speeds up the coordinator/requirement rollups which filter on (user, shared).
CREATE INDEX IF NOT EXISTS idx_sessions_user_shared
  ON public.sessions (user_id, shared_with_chapter)
  WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
