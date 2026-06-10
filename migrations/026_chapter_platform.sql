-- 026_chapter_platform.sql
-- Chapter platform Phase 1: cohort goals, per-student overrides, an admin-set
-- requirement deadline + risk window, and coordinator hour adjustments (waive/grant).

-- ── Deadline + at-risk window on the chapter ─────────────────────────────────
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS requirement_deadline date;
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS risk_window_days integer NOT NULL DEFAULT 60;

-- ── Per-student goal override (a user belongs to one chapter) ─────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS chapter_goal_override integer;

-- ── Cohort goals: a required-hours value per graduation year ──────────────────
CREATE TABLE IF NOT EXISTS public.chapter_cohort_goals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id      uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  graduation_year integer NOT NULL,
  required_hours  integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chapter_id, graduation_year)
);
ALTER TABLE public.chapter_cohort_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chapter_cohort_goals_service ON public.chapter_cohort_goals;
CREATE POLICY chapter_cohort_goals_service ON public.chapter_cohort_goals
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── Hour adjustments: coordinator grants/waives credit toward the requirement ─
-- Positive hours = credit added; negative = removed. Always counts toward the goal.
CREATE TABLE IF NOT EXISTS public.chapter_hour_adjustments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id  uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  hours       numeric NOT NULL,
  reason      text,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hour_adj_user ON public.chapter_hour_adjustments (user_id);
CREATE INDEX IF NOT EXISTS idx_hour_adj_chapter ON public.chapter_hour_adjustments (chapter_id);
ALTER TABLE public.chapter_hour_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chapter_hour_adj_service ON public.chapter_hour_adjustments;
CREATE POLICY chapter_hour_adj_service ON public.chapter_hour_adjustments
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
