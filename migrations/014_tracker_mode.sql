-- ─────────────────────────────────────────────────────────────────────────────
-- 014_tracker_mode.sql
-- Purpose: Add self_reported and tracker_note columns to sessions table
--          to support "tracker mode" (no supervisor, auto-verified hours).
-- Run manually in Supabase SQL Editor.
-- Date: 2026-05-31
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS self_reported boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracker_note  text;

-- Index for filtering self-reported sessions on dashboard stats
CREATE INDEX IF NOT EXISTS idx_sessions_self_reported
  ON public.sessions (user_id, self_reported)
  WHERE self_reported = true;

-- ── Verification ──────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'sessions'
--   AND column_name IN ('self_reported', 'tracker_note');
-- Expect 2 rows.
