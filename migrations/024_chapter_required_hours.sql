-- 024_chapter_required_hours.sql
-- Adds a per-chapter service-hour requirement so coordinators can track which
-- students have met the graduation / membership threshold (e.g. 30 verified hours).
-- graduation_year already exists on users (set via profile), so cohort grouping
-- needs no new column there.

ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS required_hours integer NOT NULL DEFAULT 0;

-- Helpful for cohort filtering as rosters grow.
CREATE INDEX IF NOT EXISTS idx_users_chapter_gradyear
  ON public.users (chapter_id, graduation_year)
  WHERE chapter_id IS NOT NULL;

-- Roster imports pre-fill a student's name + grad year on the invite so the
-- coordinator sees a real roster before students activate their accounts.
-- These are copied onto the user row when the invite is accepted.
ALTER TABLE public.chapter_invites ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.chapter_invites ADD COLUMN IF NOT EXISTS graduation_year integer;
